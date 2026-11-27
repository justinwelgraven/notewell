//! Files next to the notes file, in Notewell's data folder:
//!   images/<id>.dataurl     pictures in notes (+ images/pending.json: pictures not yet uploaded to Dropbox)
//!   backups/notewell-YYYY-MM-DD.json   one copy of the notes per day, the last 14 days
//!
//! Pictures used to live in the web view's own storage, which Windows/macOS may clear; as normal files
//! they're as safe as the notes themselves.

use std::{fs, path::PathBuf, time::SystemTime};
use tauri::{AppHandle, Manager};

const BACKUP_DAYS: usize = 14;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("images");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Only plain file names (ids), never paths.
fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty() && name.len() <= 128 && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) && !name.starts_with('.');
    if ok {
        Ok(name)
    } else {
        Err("invalid file name".into())
    }
}

/// Writes atomically (temp file + rename), so a crash never leaves half a file.
fn write_atomic(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn image_file_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = images_dir(&app)?.join(safe_name(&name)?);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn image_file_write(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    let path = images_dir(&app)?.join(safe_name(&name)?);
    write_atomic(&path, &contents)
}

// ---- Daily backups ----

/// Today's date (UTC) as YYYY-MM-DD, without extra dependencies.
fn today() -> String {
    let days = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs() / 86_400).unwrap_or(0) as i64;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// After a save: the first save of each day also becomes that day's backup; only the newest
/// BACKUP_DAYS are kept. Never fails the save itself.
pub fn daily_backup(app: &AppHandle, contents: &str) {
    let Ok(dir) = backups_dir(app) else { return };
    let path = dir.join(format!("notewell-{}.json", today()));
    if !path.exists() {
        let _ = write_atomic(&path, contents);
    }
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map(|it| {
            it.filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("notewell-") && n.ends_with(".json")))
                .collect()
        })
        .unwrap_or_default();
    files.sort(); // names sort by date
    if files.len() > BACKUP_DAYS {
        for old in &files[..files.len() - BACKUP_DAYS] {
            let _ = fs::remove_file(old);
        }
    }
}

/// Path of the backups folder (Settings → "Show daily backups" opens it).
#[tauri::command]
pub fn backups_folder(app: AppHandle) -> Result<String, String> {
    Ok(backups_dir(&app)?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn today_is_a_date() {
        let t = super::today();
        assert_eq!(t.len(), 10);
        assert!(t.starts_with("20"));
        assert_eq!(&t[4..5], "-");
    }

    #[test]
    fn rejects_paths() {
        assert!(super::safe_name("../x").is_err());
        assert!(super::safe_name("a/b").is_err());
        assert!(super::safe_name("abc123.dataurl").is_ok());
        assert!(super::safe_name("pending.json").is_ok());
    }
}
