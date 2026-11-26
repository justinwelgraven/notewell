mod dropbox;

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const DATA_FILE: &str = "notewell-data.json";
const MAX_HTML_BYTES: usize = 3 * 1024 * 1024;

#[cfg(windows)]
#[tauri::command]
fn set_caption_colors(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // Match the editor's --bg and --text. Neutral grays have identical RGB and COLORREF values.
    let colors: [(_, u32); 2] = [
        (DWMWA_CAPTION_COLOR, if dark { 0x212121 } else { 0xffffff }),
        (DWMWA_TEXT_COLOR, if dark { 0xe2e2e2 } else { 0x333333 }),
    ];
    for (attribute, color) in colors {
        // DWM reads a single COLORREF synchronously from this local value.
        unsafe { DwmSetWindowAttribute(hwnd, attribute, (&color as *const u32).cast(), 4) }
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(DATA_FILE))
}

/// Returns the saved notes JSON, or None on first launch.
#[tauri::command]
fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

/// Writes the notes JSON atomically (temp file + rename) and keeps one backup.
#[tauri::command]
fn save_data(app: AppHandle, data: String) -> Result<(), String> {
    let path = data_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("json.bak"));
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Spell check in English and Dutch (Windows). WebView2 checks spelling with Windows' own spell
/// checker, but only for the languages in its "spellcheck.dictionaries" setting, which starts out as
/// just the Windows display language. Add both to its settings file before any window opens.
/// (Mac and iPhone use the system spell checker, which detects the language by itself.)
#[cfg(windows)]
fn enable_spellcheck_languages(identifier: &str) {
    const WANTED: [&str; 2] = ["en-US", "nl-NL"];
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return };
    let path = PathBuf::from(local).join(identifier).join("EBWebView").join("Default").join("Preferences");
    let mut prefs: serde_json::Value = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !prefs.is_object() {
        return;
    }
    let current: Vec<String> = prefs
        .pointer("/spellcheck/dictionaries")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if WANTED.iter().all(|w| current.iter().any(|c| c == w)) {
        return; // already set
    }
    let mut dictionaries = current;
    for w in WANTED {
        if !dictionaries.iter().any(|c| c == w) {
            dictionaries.push(w.to_string());
        }
    }
    prefs["spellcheck"]["dictionaries"] = serde_json::json!(dictionaries);
    prefs["spellcheck"]["use_spelling_service"] = serde_json::json!(false); // never send text online
    prefs["intl"]["accept_languages"] = serde_json::json!(dictionaries.join(","));
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&path, prefs.to_string());
}

#[cfg(all(test, windows))]
mod spellcheck_tests {
    use super::*;

    #[test]
    fn adds_dutch_and_keeps_other_settings() {
        let tmp = std::env::temp_dir().join(format!("nw-spell-{}", std::process::id()));
        let prefs = tmp.join("test.id").join("EBWebView").join("Default").join("Preferences");
        fs::create_dir_all(prefs.parent().unwrap()).unwrap();
        fs::write(&prefs, r#"{"spellcheck":{"dictionaries":["en-US"]},"other":{"keep":1}}"#).unwrap();
        std::env::set_var("LOCALAPPDATA", &tmp);
        enable_spellcheck_languages("test.id");
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&prefs).unwrap()).unwrap();
        assert_eq!(v["spellcheck"]["dictionaries"], serde_json::json!(["en-US", "nl-NL"]));
        assert_eq!(v["other"]["keep"], 1);
        // Second run: nothing to change.
        let before = fs::read_to_string(&prefs).unwrap();
        enable_spellcheck_languages("test.id");
        assert_eq!(before, fs::read_to_string(&prefs).unwrap());
        let _ = fs::remove_dir_all(&tmp);
    }
}

/// Writes an export/backup file to the Downloads folder (never overwriting) and returns its path.
#[tauri::command]
fn save_export(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let (stem, ext) = match safe.rfind('.') {
        Some(i) => (safe[..i].to_string(), safe[i..].to_string()),
        None => (safe.clone(), String::new()),
    };
    let mut path = dir.join(&safe);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct FetchedPage {
    final_url: String,
    html: String,
}

/// Fetches a web page's HTML so the UI can read its Open Graph tags for link previews.
/// Done natively because the web view itself is blocked by CORS.
#[tauri::command]
async fn fetch_page(url: String) -> Result<FetchedPage, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) URLs are supported".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Notewell/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let slice = &bytes[..bytes.len().min(MAX_HTML_BYTES)];
    Ok(FetchedPage {
        final_url,
        html: String::from_utf8_lossy(slice).into_owned(),
    })
}

const QUICK_W: f64 = 460.0;
const QUICK_H: f64 = 540.0;

/// Opens the small always-on-top quick note window, or brings it forward if already open.
/// Must be `async`: on Windows, creating a window from a synchronous command deadlocks the app
/// (the menu button hung Notewell; the shortcut and tray menu don't go through a command).
#[tauri::command]
async fn open_quick_note(app: AppHandle) {
    show_quick_note(&app);
}

fn show_quick_note(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let mut builder = WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html".into()))
        .title("Quick Note")
        .inner_size(QUICK_W, QUICK_H)
        .min_inner_size(340.0, 300.0)
        .always_on_top(true)
        .focused(true);
    // Bottom-right corner of the screen, like a sticky note.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
        builder = builder.position(
            (size.width - QUICK_W - 28.0).max(0.0),
            (size.height - QUICK_H - 90.0).max(0.0),
        );
    }
    if let Ok(w) = builder.build() {
        let _ = w.set_focus();
    }
}

/// Called by a window's page once it has saved, to actually close that window.
#[tauri::command]
fn finish_close(window: tauri::WebviewWindow) {
    let _ = window.destroy();
}

/// Set when the user chose Quit, so closing the main window really exits
/// instead of hiding to the tray.
struct Quitting(AtomicBool);

/// Asks a window's page to save and close itself (`finish_close`).
/// If the page doesn't answer within a few seconds (e.g. it froze), the window is closed anyway.
fn request_page_close(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else { return };
    if app.emit_to(label, "app-close-requested", ()).is_err() {
        let _ = window.destroy();
        return;
    }
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    });
}

fn handle_close_request(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    api.prevent_close();
    let app = window.app_handle();
    let quitting = app.state::<Quitting>().0.load(Ordering::SeqCst);
    if window.label() == "main" && !quitting && cfg!(desktop) {
        // X button on the main window: keep running in the tray so Ctrl+Alt+N keeps working.
        // The page stays alive in the background, so its autosave still finishes.
        let _ = window.hide();
    } else {
        request_page_close(app, window.label());
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Really quits: the main page saves first, then the app exits.
fn quit_app(app: &AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::SeqCst);
    if app.get_webview_window("quick").is_some() {
        request_page_close(app, "quick");
    }
    if app.get_webview_window("main").is_some() {
        request_page_close(app, "main");
    } else {
        app.exit(0);
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    quit_app(&app);
}

#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "Open Notewell", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", format!("New quick note\t{QUICK_LABEL}"), true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notewell", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("notewell")
        .tooltip(format!("Notewell · {QUICK_LABEL} for a quick note"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quick" => show_quick_note(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    // macOS menu bar: a black "template" image that the system tints for light/dark menu bars.
    #[cfg(target_os = "macos")]
    {
        tray = tray
            .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?)
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// The system-wide quick note shortcut: Ctrl+Alt+N on Windows/Linux, Option+Cmd+N on Mac.
#[cfg(desktop)]
fn quick_note_modifiers() -> tauri_plugin_global_shortcut::Modifiers {
    use tauri_plugin_global_shortcut::Modifiers;
    if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::ALT
    } else {
        Modifiers::CONTROL | Modifiers::ALT
    }
}

#[cfg(target_os = "macos")]
const QUICK_LABEL: &str = "⌥⌘N";
#[cfg(not(target_os = "macos"))]
const QUICK_LABEL: &str = "Ctrl+Alt+N";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any window (and its WebView2 browser) starts: spell check English + Dutch.
    #[cfg(windows)]
    enable_spellcheck_languages("com.notewell.desktop");

    let builder = tauri::Builder::default().manage(Quitting(AtomicBool::new(false)));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // Starting Notewell again just brings the open window forward,
        // so two copies never overwrite each other's notes.
        show_main(app);
    }));

    let builder = builder.plugin(tauri_plugin_opener::init());

    // Automatic updates: checks GitHub releases, installs signed updates, restarts the app.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = {
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
        builder
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, shortcut, event| {
                        if event.state() == ShortcutState::Pressed && shortcut.matches(quick_note_modifiers(), Code::KeyN) {
                            show_quick_note(app);
                        }
                    })
                    .build(),
            )
            .setup(|app| {
                let quick = Shortcut::new(Some(quick_note_modifiers()), Code::KeyN);
                if let Err(e) = app.global_shortcut().register(quick) {
                    eprintln!("Could not register {QUICK_LABEL} (another app may be using it): {e}");
                }
                build_tray(app)?;
                Ok(())
            })
    };

    builder
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => handle_close_request(window, api),
            // The main window owns the notes, so once it's gone (after Quit) the app exits.
            WindowEvent::Destroyed if window.label() == "main" => window.app_handle().exit(0),
            _ => {}
        })
        .manage(dropbox::DropboxState::default())
        .invoke_handler(tauri::generate_handler![
            #[cfg(windows)]
            set_caption_colors,
            load_data,
            save_data,
            save_export,
            fetch_page,
            open_quick_note,
            finish_close,
            quit,
            dropbox::dropbox_status,
            dropbox::dropbox_connect,
            dropbox::dropbox_disconnect,
            dropbox::dropbox_request
        ])
        .build(tauri::generate_context!())
        .expect("error while running Notewell")
        .run(|app, event| match event {
            // Cmd+Q / app-menu Quit / logout: save first, then exit.
            tauri::RunEvent::ExitRequested { api, .. } if !app.state::<Quitting>().0.load(Ordering::SeqCst) => {
                api.prevent_exit();
                quit_app(app);
            }
            // Clicking the Dock icon while the window is hidden brings it back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}
