//! Spell checking with Windows' own spell checker, in English *and* Dutch at the same time.
//!
//! WebView2 (the browser inside the Windows app) only spell-checks one language — the Windows display
//! language — so the editor does its own checking on Windows: it sends paragraph texts here and draws
//! the red underlines itself (src/editor/NativeSpell.ts). A word counts as misspelled only when it's
//! wrong in every installed language, so mixed English/Dutch notes work.
//!
//! All COM work happens on one background thread that owns the spell checkers.
//! On other systems these commands do nothing (Mac/iPhone use the system spell checker).

/// Languages to check, when Windows has a spell checker for them ("Basic typing" installed).
#[cfg(windows)]
const LANGUAGES: [&str; 2] = ["en-US", "nl-NL"];

/// Misspelled ranges per text, as (start, length) in UTF-16 units (= JavaScript string indices).
pub type Ranges = Vec<(u32, u32)>;

#[cfg(windows)]
mod imp {
    use super::{Ranges, LANGUAGES};
    use std::sync::{mpsc, Mutex, OnceLock};
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Globalization::{
        ISpellChecker, ISpellCheckerFactory, ISpellingError, SpellCheckerFactory, CORRECTIVE_ACTION_NONE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

    pub enum Req {
        Languages(mpsc::Sender<Vec<String>>),
        Check(Vec<String>, mpsc::Sender<Vec<Ranges>>),
        Suggest(String, mpsc::Sender<Vec<String>>),
        Add(String),
        Ignore(String),
    }

    static WORKER: OnceLock<Mutex<mpsc::Sender<Req>>> = OnceLock::new();

    pub fn send(req: Req) {
        let tx = WORKER
            .get_or_init(|| {
                let (tx, rx) = mpsc::channel();
                std::thread::spawn(move || run(rx));
                Mutex::new(tx)
            })
            .lock()
            .unwrap()
            .clone();
        let _ = tx.send(req);
    }

    fn run(rx: mpsc::Receiver<Req>) {
        let checkers: Vec<(String, ISpellChecker)> = unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            match CoCreateInstance::<_, ISpellCheckerFactory>(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER) {
                Ok(factory) => LANGUAGES
                    .iter()
                    .filter_map(|lang| {
                        let tag = HSTRING::from(*lang);
                        let ok = factory.IsSupported(&tag).map(|b| b.as_bool()).unwrap_or(false);
                        if !ok {
                            return None;
                        }
                        factory.CreateSpellChecker(&tag).ok().map(|c| (lang.to_string(), c))
                    })
                    .collect(),
                Err(_) => Vec::new(),
            }
        };

        for req in rx {
            match req {
                Req::Languages(reply) => {
                    let _ = reply.send(checkers.iter().map(|(l, _)| l.clone()).collect());
                }
                Req::Check(texts, reply) => {
                    let out = texts.iter().map(|t| check_all(&checkers, t)).collect();
                    let _ = reply.send(out);
                }
                Req::Suggest(word, reply) => {
                    let _ = reply.send(suggest_all(&checkers, &word));
                }
                Req::Add(word) => {
                    for (_, c) in &checkers {
                        let _ = unsafe { c.Add(&HSTRING::from(word.as_str())) };
                    }
                }
                Req::Ignore(word) => {
                    for (_, c) in &checkers {
                        let _ = unsafe { c.Ignore(&HSTRING::from(word.as_str())) };
                    }
                }
            }
        }
    }

    fn check_one(checker: &ISpellChecker, text: &str) -> Ranges {
        let mut out = Vec::new();
        let Ok(errors) = (unsafe { checker.Check(&HSTRING::from(text)) }) else { return out };
        loop {
            let mut error: Option<ISpellingError> = None;
            let hr = unsafe { errors.Next(&mut error) };
            if hr.0 != 0 {
                break; // S_FALSE: no more errors
            }
            let Some(e) = error else { break };
            unsafe {
                if let (Ok(start), Ok(len), Ok(action)) = (e.StartIndex(), e.Length(), e.CorrectiveAction()) {
                    if action != CORRECTIVE_ACTION_NONE {
                        out.push((start, len));
                    }
                }
            }
        }
        out
    }

    /// Wrong only if wrong in every language.
    fn check_all(checkers: &[(String, ISpellChecker)], text: &str) -> Ranges {
        if text.trim().is_empty() || checkers.is_empty() {
            return Vec::new();
        }
        let mut result = check_one(&checkers[0].1, text);
        for (_, c) in &checkers[1..] {
            if result.is_empty() {
                break;
            }
            let other = check_one(c, text);
            result.retain(|r| other.contains(r));
        }
        result
    }

    fn suggest_one(checker: &ISpellChecker, word: &str) -> Vec<String> {
        let mut out = Vec::new();
        let Ok(list) = (unsafe { checker.Suggest(&HSTRING::from(word)) }) else { return out };
        loop {
            let mut item = [PWSTR::null()];
            let mut fetched = 0u32;
            let hr = unsafe { list.Next(&mut item, Some(&mut fetched)) };
            if hr.0 != 0 || fetched == 0 {
                break;
            }
            unsafe {
                if let Ok(s) = item[0].to_string() {
                    out.push(s);
                }
                CoTaskMemFree(Some(item[0].0 as _));
            }
        }
        out
    }

    /// Suggestions from all languages, taking turns, without duplicates.
    fn suggest_all(checkers: &[(String, ISpellChecker)], word: &str) -> Vec<String> {
        let lists: Vec<Vec<String>> = checkers.iter().map(|(_, c)| suggest_one(c, word)).collect();
        let mut out: Vec<String> = Vec::new();
        for i in 0..lists.iter().map(|l| l.len()).max().unwrap_or(0) {
            for l in &lists {
                if let Some(s) = l.get(i) {
                    if s != word && !out.contains(s) {
                        out.push(s.clone());
                    }
                }
            }
        }
        out.truncate(8);
        out
    }
}

/// Spell-check languages Windows has available (empty elsewhere: the app then uses the browser's own).
#[tauri::command]
pub async fn spell_languages() -> Vec<String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        imp::send(imp::Req::Languages(tx));
        return rx.recv().unwrap_or_default();
    }
    #[cfg(not(windows))]
    Vec::new()
}

#[tauri::command]
pub async fn spell_check(texts: Vec<String>) -> Vec<Ranges> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        imp::send(imp::Req::Check(texts, tx));
        return rx.recv().unwrap_or_default();
    }
    #[cfg(not(windows))]
    texts.iter().map(|_| Vec::new()).collect()
}

#[tauri::command]
pub async fn spell_suggest(word: String) -> Vec<String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        imp::send(imp::Req::Suggest(word, tx));
        return rx.recv().unwrap_or_default();
    }
    #[cfg(not(windows))]
    {
        let _ = word;
        Vec::new()
    }
}

/// Adds a word to the Windows dictionary (all checked languages) — it stays correct from now on.
#[tauri::command]
pub async fn spell_add(word: String) {
    #[cfg(windows)]
    imp::send(imp::Req::Add(word));
    #[cfg(not(windows))]
    let _ = word;
}

/// Ignores a word until Notewell restarts.
#[tauri::command]
pub async fn spell_ignore(word: String) {
    #[cfg(windows)]
    imp::send(imp::Req::Ignore(word));
    #[cfg(not(windows))]
    let _ = word;
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn checks_english_and_dutch_together() {
        let langs = tauri::async_runtime::block_on(super::spell_languages());
        println!("languages: {langs:?}");
        let text = "Ik heb een fiets gekogt and this is beautifull.".to_string();
        let r = tauri::async_runtime::block_on(super::spell_check(vec![text.clone()]));
        let words: Vec<String> = r[0]
            .iter()
            .map(|(s, l)| text.encode_utf16().skip(*s as usize).take(*l as usize).map(|c| char::from_u32(c as u32).unwrap()).collect())
            .collect();
        println!("misspelled: {words:?}");
        assert!(words.contains(&"beautifull".to_string()));
        if langs.iter().any(|l| l == "nl-NL") {
            assert!(words.contains(&"gekogt".to_string()));
            assert!(!words.iter().any(|w| w == "fiets" || w == "heb"), "Dutch words must not be flagged");
        }
        let s = tauri::async_runtime::block_on(super::spell_suggest("beautifull".into()));
        println!("suggestions: {s:?}");
        assert!(s.iter().any(|x| x == "beautiful"));
    }
}
