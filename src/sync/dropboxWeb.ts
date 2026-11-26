/**
 * Dropbox for the web version (iPhone / browser). Same job as src-tauri/src/dropbox.rs,
 * but done with fetch(): Dropbox's API allows calls straight from a web page.
 *
 * Sign-in: the page redirects to Dropbox and Dropbox sends the user back to this page
 * with ?code=..., which `completeWebSignIn()` exchanges for tokens (OAuth PKCE, no secret).
 * From the iPhone Home Screen app the code is pasted in instead (iOS doesn't reliably return redirects there).
 * Only the long-lived refresh token is kept (localStorage + IndexedDB); access tokens live in memory.
 */

import { idbDelete, idbGet, idbSet } from "../lib/idb";

const STORE_KEY = "notewell-dbx-web";
const PENDING_KEY = "notewell-dbx-pending";

interface Stored {
  app_key: string;
  refresh_token: string;
  account: string | null;
}

let stored: Stored | null = null;
let access: { token: string; expiresAt: number } | null = null;

function readStored(): Stored | null {
  if (!stored) {
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch {
      stored = null;
    }
  }
  return stored;
}

/** Saved in two places (localStorage + IndexedDB): if iOS clears one, the other restores it. */
function writeStored(s: Stored | null) {
  stored = s;
  if (s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    idbSet(STORE_KEY, s).catch(() => {});
  } else {
    localStorage.removeItem(STORE_KEY);
    idbDelete(STORE_KEY).catch(() => {});
  }
}

/** Call once at startup, before webStatus(): brings back a sign-in that only survived in one place. */
export async function restoreWebAuth(): Promise<void> {
  const fromLocal = readStored();
  const fromDb = await idbGet<Stored>(STORE_KEY).catch(() => undefined);
  if (fromLocal && !fromDb) idbSet(STORE_KEY, fromLocal).catch(() => {});
  if (!fromLocal && fromDb?.refresh_token) {
    stored = fromDb;
    localStorage.setItem(STORE_KEY, JSON.stringify(fromDb));
  }
}

/** True when opened from the iPhone Home Screen (not in a Safari tab). */
export const isHomeScreenApp = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

/** Where Dropbox sends the user back to. Must be listed under Redirect URIs in the Dropbox app. */
export function webRedirectUri(): string {
  return location.origin + location.pathname;
}

export function webStatus() {
  const s = readStored();
  return { connected: !!s, account: s?.account ?? null, app_key: s?.app_key ?? null };
}

/** Safari tab: leaves the page for Dropbox's sign-in; Dropbox sends the user back with ?code=. */
export function startWebSignIn(appKey: string, verifier: string, authUrl: string) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ appKey, verifier, redirectUri: webRedirectUri() }));
  location.assign(authUrl);
}

/**
 * Home Screen app: iOS doesn't reliably bring a redirect back into the app, so Dropbox opens on top
 * and shows a code instead; the user pastes it into Notewell (finishWebSignInWithCode).
 */
export function startCodeSignIn(appKey: string, verifier: string, authUrl: string) {
  // No window.open here: iOS blocks pop-ups that aren't opened directly by a tap. The dialog shows
  // an "Open Dropbox" link the user taps instead. Kept in localStorage so the step survives iOS
  // pausing or restarting the app while the user is on Dropbox's page.
  localStorage.setItem(PENDING_KEY, JSON.stringify({ appKey, verifier, redirectUri: null, url: authUrl, at: Date.now() }));
}

/** A Home Screen sign-in waiting for its code (started less than 30 minutes ago), or null. */
export function pendingCodeSignIn(): { url: string } | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (p?.url && Date.now() - (p.at ?? 0) < 30 * 60 * 1000) return { url: p.url };
  } catch {}
  return null;
}

export function cancelCodeSignIn() {
  localStorage.removeItem(PENDING_KEY);
}

export async function finishWebSignInWithCode(code: string): Promise<string> {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) throw new Error("Start again: tap Connect Dropbox first");
  const pending = JSON.parse(raw) as { appKey: string; verifier: string };
  const t = await tokenRequest({ code: code.trim(), grant_type: "authorization_code", client_id: pending.appKey, code_verifier: pending.verifier });
  localStorage.removeItem(PENDING_KEY);
  return saveNewSignIn(pending.appKey, t);
}

async function saveNewSignIn(appKey: string, t: { access_token: string; expires_in?: number; refresh_token?: string }) {
  if (!t.refresh_token) throw new Error("Dropbox didn't return a refresh token");
  access = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 14400) * 1000 };
  let account: string | null = null;
  try {
    const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}` },
    });
    const v = await r.json();
    account = v.email ?? v.name?.display_name ?? null;
  } catch {}
  writeStored({ app_key: appKey, refresh_token: t.refresh_token, account });
  return account ?? "Dropbox";
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status}): ${text}`);
  return JSON.parse(text) as { access_token: string; expires_in?: number; refresh_token?: string };
}

/** Call once on page load: finishes a sign-in if we just came back from Dropbox. */
export async function completeWebSignIn(): Promise<string | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  if (!pendingRaw || (!code && !error)) return null;

  sessionStorage.removeItem(PENDING_KEY);
  history.replaceState(null, "", url.pathname); // tidy the address bar
  if (!code) throw new Error(`Dropbox sign-in was cancelled. ${error ?? ""}`);

  const pending = JSON.parse(pendingRaw) as { appKey: string; verifier: string; redirectUri: string };
  const t = await tokenRequest({
    code,
    grant_type: "authorization_code",
    client_id: pending.appKey,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
  });
  return saveNewSignIn(pending.appKey, t);
}

async function accessToken(forceRefresh: boolean): Promise<string> {
  const s = readStored();
  if (!s) throw new Error("Not connected to Dropbox");
  if (!forceRefresh && access && Date.now() + 60000 < access.expiresAt) return access.token;
  let t;
  try {
    t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: s.app_key });
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`offline: ${e.message}`); // no network: try again later
    // Dropbox no longer accepts this sign-in (e.g. app access removed): ask to reconnect.
    if (/invalid_grant|400|401/.test(String(e))) throw new Error("Not connected: Dropbox sign-in expired, please reconnect");
    throw e;
  }
  access = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 14400) * 1000 };
  return access.token;
}

export async function webDisconnect() {
  try {
    const token = await accessToken(false);
    await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  } catch {}
  access = null;
  writeStored(null);
}

/** Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX. */
const headerSafe = (json: string) => json.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Same contract as the native `dropbox_request` command. */
export async function webRequest(
  kind: string,
  endpoint: string,
  arg: string | null,
  body: string | null,
): Promise<{ status: number; body: string; result: string | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = kind === "rpc" ? "api" : kind === "longpoll" ? "notify" : "content";
    const headers: Record<string, string> = {};
    if (kind !== "longpoll") headers.Authorization = `Bearer ${await accessToken(attempt > 0)}`;
    if (kind === "rpc" || kind === "longpoll") headers["Content-Type"] = "application/json";
    if (kind === "upload") headers["Content-Type"] = "application/octet-stream";
    if (kind === "upload" || kind === "download") headers["Dropbox-API-Arg"] = headerSafe(arg ?? "{}");

    let res: Response;
    try {
      res = await fetch(`https://${host}.dropboxapi.com/2/${endpoint}`, {
        method: "POST",
        headers,
        body: kind === "download" ? undefined : (body ?? (kind === "upload" ? "" : "null")),
      });
    } catch (e) {
      throw new Error(`offline: ${e}`);
    }
    if (res.status === 401 && kind !== "longpoll" && attempt === 0) continue;
    return { status: res.status, body: await res.text(), result: res.headers.get("dropbox-api-result") };
  }
  throw new Error("Dropbox access expired");
}
