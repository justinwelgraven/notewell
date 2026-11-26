//! Dropbox connection: sign-in (OAuth with PKCE, no secret needed) and authenticated API calls.
//! The sync logic itself lives in the web layer (src/sync); this file only moves bytes and
//! keeps the access token fresh.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const AUTH_FILE: &str = "dropbox-auth.json";

#[derive(Serialize, Deserialize, Clone)]
struct Auth {
    app_key: String,
    refresh_token: String,
    access_token: String,
    /// Unix seconds.
    expires_at: u64,
    account: Option<String>,
}

pub struct DropboxState {
    auth: Mutex<Option<Auth>>,
    client: reqwest::Client,
}

impl Default for DropboxState {
    fn default() -> Self {
        Self {
            auth: Mutex::new(None),
            client: reqwest::Client::builder()
                .user_agent("Notewell/0.1")
                .build()
                .expect("http client"),
        }
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn auth_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(AUTH_FILE))
}

/// What is kept between launches: only the long-lived parts. The access token lives in memory.
#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct StoredAuth {
    app_key: String,
    refresh_token: String,
    account: Option<String>,
}

impl From<&Auth> for StoredAuth {
    fn from(a: &Auth) -> Self {
        Self { app_key: a.app_key.clone(), refresh_token: a.refresh_token.clone(), account: a.account.clone() }
    }
}

/// The sign-in is kept in the system's secure store: Windows Credential Manager / macOS Keychain.
fn keychain() -> Option<keyring::Entry> {
    keyring::Entry::new("com.notewell.desktop", "dropbox").ok()
}

fn read_stored(app: &AppHandle) -> Option<StoredAuth> {
    if let Some(raw) = keychain().and_then(|k| k.get_password().ok()) {
        if let Ok(s) = serde_json::from_str::<StoredAuth>(&raw) {
            return Some(s);
        }
    }
    // Older versions kept it in a plain file: move it into the keychain, then delete the file.
    let path = auth_path(app).ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    let old: Auth = serde_json::from_str(&raw).ok()?;
    let stored = StoredAuth::from(&old);
    if write_stored(Some(&stored)).is_ok() {
        let _ = fs::remove_file(&path);
    }
    Some(stored)
}

fn write_stored(stored: Option<&StoredAuth>) -> Result<(), String> {
    let k = keychain().ok_or("The system keychain isn't available")?;
    match stored {
        Some(s) => k.set_password(&serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string()),
        None => match k.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

fn load_auth(app: &AppHandle, state: &DropboxState) -> Option<Auth> {
    let mut guard = state.auth.lock().unwrap();
    if guard.is_none() {
        *guard = read_stored(app).map(|s| Auth {
            app_key: s.app_key,
            refresh_token: s.refresh_token,
            access_token: String::new(),
            expires_at: 0, // fetch a fresh access token on first use
            account: s.account,
        });
    }
    guard.clone()
}

fn store_auth(app: &AppHandle, state: &DropboxState, auth: Option<Auth>) -> Result<(), String> {
    let before = state.auth.lock().unwrap().as_ref().map(StoredAuth::from);
    let after = auth.as_ref().map(StoredAuth::from);
    if before != after || after.is_none() {
        write_stored(after.as_ref())?;
    }
    if auth.is_none() {
        if let Ok(path) = auth_path(app) {
            let _ = fs::remove_file(path);
        }
    }
    *state.auth.lock().unwrap() = auth;
    Ok(())
}

fn form(pairs: &[(&str, &str)]) -> String {
    fn enc(s: &str) -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                _ => format!("%{:02X}", b),
            })
            .collect()
    }
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

async fn token_request(state: &DropboxState, body: String) -> Result<TokenResponse, String> {
    let resp = state
        .client
        .post("https://api.dropboxapi.com/oauth2/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(30))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Dropbox: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Dropbox sign-in failed ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Returns a valid access token, refreshing it when it's about to expire.
async fn access_token(app: &AppHandle, state: &DropboxState, force_refresh: bool) -> Result<String, String> {
    let mut auth = load_auth(app, state).ok_or("Not connected to Dropbox")?;
    if !force_refresh && now() + 60 < auth.expires_at {
        return Ok(auth.access_token);
    }
    let t = token_request(
        state,
        form(&[("grant_type", "refresh_token"), ("refresh_token", &auth.refresh_token), ("client_id", &auth.app_key)]),
    )
    .await?;
    auth.access_token = t.access_token;
    auth.expires_at = now() + t.expires_in.unwrap_or(14400);
    let token = auth.access_token.clone();
    store_auth(app, state, Some(auth))?;
    Ok(token)
}

/// Waits for the browser to come back to http://localhost:<port>/callback and returns the query string.
async fn wait_for_redirect(port: u16) -> Result<String, String> {
    let v4 = tokio::net::TcpListener::bind(("127.0.0.1", port)).await;
    let v6 = tokio::net::TcpListener::bind(("::1", port)).await;
    if v4.is_err() && v6.is_err() {
        return Err(format!("Port {port} is in use, so Notewell can't receive the Dropbox sign-in. Close the app using it and try again."));
    }
    async fn accept(l: &Result<tokio::net::TcpListener, std::io::Error>) -> std::io::Result<tokio::net::TcpStream> {
        match l {
            Ok(l) => l.accept().await.map(|(s, _)| s),
            Err(_) => std::future::pending().await,
        }
    }
    loop {
        let mut stream = tokio::select! {
            s = accept(&v4) => s.map_err(|e| e.to_string())?,
            s = accept(&v6) => s.map_err(|e| e.to_string())?,
        };
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]).to_string();
        let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("").to_string();
        if !target.starts_with("/callback") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let ok = target.contains("code=");
        let page = format!(
            "<!doctype html><meta charset=utf-8><title>Notewell</title><body style=\"font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333\"><div style=\"text-align:center\"><div style=\"font-size:44px\">{}</div><h2>{}</h2><p>You can close this tab and go back to Notewell.</p></div>",
            if ok { "✅" } else { "⚠️" },
            if ok { "Notewell is connected to Dropbox" } else { "Dropbox sign-in was cancelled" }
        );
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            page.len(),
            page
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        let _ = stream.shutdown().await;
        return Ok(target.split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default());
    }
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k != key {
            return None;
        }
        // percent-decode
        let bytes = v.replace('+', " ").into_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        Some(String::from_utf8_lossy(&out).into_owned())
    })
}

#[derive(Serialize)]
pub struct DropboxStatus {
    connected: bool,
    account: Option<String>,
    app_key: Option<String>,
}

#[tauri::command]
pub fn dropbox_status(app: AppHandle, state: State<'_, DropboxState>) -> DropboxStatus {
    match load_auth(&app, &state) {
        Some(a) => DropboxStatus { connected: true, account: a.account, app_key: Some(a.app_key) },
        None => DropboxStatus { connected: false, account: None, app_key: None },
    }
}

/// Opens the Dropbox sign-in page in the browser and waits (up to 5 minutes) for the user to approve.
#[tauri::command]
pub async fn dropbox_connect(
    app: AppHandle,
    state: State<'_, DropboxState>,
    app_key: String,
    auth_url: String,
    verifier: String,
    redirect_uri: String,
    port: u16,
) -> Result<String, String> {
    let waiter = tokio::spawn(wait_for_redirect(port));
    // Give the listener a moment to bind before the browser can redirect back.
    tokio::time::sleep(Duration::from_millis(150)).await;
    app.opener().open_url(&auth_url, None::<&str>).map_err(|e| e.to_string())?;

    let query = tokio::time::timeout(Duration::from_secs(300), waiter)
        .await
        .map_err(|_| "Timed out waiting for Dropbox sign-in".to_string())?
        .map_err(|e| e.to_string())??;
    let code = match query_param(&query, "code") {
        Some(c) => c,
        None => {
            let why = query_param(&query, "error_description").or_else(|| query_param(&query, "error")).unwrap_or_default();
            return Err(format!("Dropbox sign-in was cancelled. {why}"));
        }
    };

    let t = token_request(
        &state,
        form(&[
            ("code", &code),
            ("grant_type", "authorization_code"),
            ("client_id", &app_key),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
        ]),
    )
    .await?;
    let refresh_token = t.refresh_token.ok_or("Dropbox didn't return a refresh token")?;
    let mut auth = Auth {
        app_key,
        refresh_token,
        access_token: t.access_token,
        expires_at: now() + t.expires_in.unwrap_or(14400),
        account: None,
    };

    // Account name, for display only.
    if let Ok(resp) = state
        .client
        .post("https://api.dropboxapi.com/2/users/get_current_account")
        .bearer_auth(&auth.access_token)
        .timeout(Duration::from_secs(20))
        .send()
        .await
    {
        if let Ok(v) = json_body(resp).await {
            auth.account = v
                .get("email")
                .and_then(|e| e.as_str())
                .map(String::from)
                .or_else(|| v.pointer("/name/display_name").and_then(|n| n.as_str()).map(String::from));
        }
    }
    let label = auth.account.clone().unwrap_or_else(|| "Dropbox".into());
    store_auth(&app, &state, Some(auth))?;
    Ok(label)
}

async fn json_body(resp: reqwest::Response) -> Result<serde_json::Value, String> {
    let t = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&t).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dropbox_disconnect(app: AppHandle, state: State<'_, DropboxState>) -> Result<(), String> {
    if let Ok(token) = access_token(&app, &state, false).await {
        let _ = state
            .client
            .post("https://api.dropboxapi.com/2/auth/token/revoke")
            .bearer_auth(token)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
    }
    store_auth(&app, &state, None)
}

#[derive(Serialize)]
pub struct DbxResponse {
    status: u16,
    body: String,
    /// Dropbox-API-Result header (file metadata) for downloads.
    result: Option<String>,
}

/// HTTP headers must be ASCII: Dropbox wants non-ASCII characters in Dropbox-API-Arg escaped as \uXXXX.
fn header_safe_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if (c as u32) < 0x7f {
            out.push(c);
        } else {
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{:04x}", u));
            }
        }
    }
    out
}

/// Generic Dropbox API call.
///  - kind "rpc":      api.dropboxapi.com, JSON body
///  - kind "upload":   content.dropboxapi.com, `arg` in header, `body` as file contents
///  - kind "download": content.dropboxapi.com, `arg` in header, file contents returned in `body`
///  - kind "longpoll": notify.dropboxapi.com, no token, waits for changes
#[tauri::command]
pub async fn dropbox_request(
    app: AppHandle,
    state: State<'_, DropboxState>,
    kind: String,
    endpoint: String,
    arg: Option<String>,
    body: Option<String>,
) -> Result<DbxResponse, String> {
    let mut retried = false;
    loop {
        let (host, timeout) = match kind.as_str() {
            "rpc" => ("api", 60),
            "upload" | "download" => ("content", 120),
            "longpoll" => ("notify", 600),
            _ => return Err(format!("unknown request kind {kind}")),
        };
        let url = format!("https://{host}.dropboxapi.com/2/{endpoint}");
        let mut req = state.client.post(&url).timeout(Duration::from_secs(timeout));
        if kind != "longpoll" {
            req = req.bearer_auth(access_token(&app, &state, retried).await?);
        }
        req = match kind.as_str() {
            "rpc" | "longpoll" => req
                .header("Content-Type", "application/json")
                .body(body.clone().unwrap_or_else(|| "null".into())),
            "upload" => req
                .header("Content-Type", "application/octet-stream")
                .header("Dropbox-API-Arg", header_safe_json(arg.as_deref().unwrap_or("{}")))
                .body(body.clone().unwrap_or_default()),
            _ => req.header("Dropbox-API-Arg", header_safe_json(arg.as_deref().unwrap_or("{}"))),
        };
        let resp = req.send().await.map_err(|e| format!("offline: {e}"))?;
        let status = resp.status().as_u16();
        if status == 401 && !retried && kind != "longpoll" {
            retried = true;
            continue;
        }
        let result = resp
            .headers()
            .get("dropbox-api-result")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let text = resp.text().await.map_err(|e| format!("offline: {e}"))?;
        return Ok(DbxResponse { status, body: text, result });
    }
}
