/**
 * Dropbox API used by the sync engine.
 * Desktop: native commands (src-tauri/src/dropbox.rs). Web/iPhone: fetch() (./dropboxWeb.ts).
 */
import { isTauri } from "../lib/storage";
import { completeWebSignIn, startWebSignIn, webDisconnect, webRedirectUri, webRequest, webStatus } from "./dropboxWeb";

export { completeWebSignIn };

export const REDIRECT_PORT = 53682;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export interface DropboxStatus {
  connected: boolean;
  account: string | null;
  app_key: string | null;
}

export async function dropboxStatus(): Promise<DropboxStatus> {
  if (!isTauri) return webStatus();
  return invoke<DropboxStatus>("dropbox_status");
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Opens Dropbox sign-in in the browser (OAuth PKCE) and resolves with the account name once approved. */
export async function connectDropbox(appKey: string): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: isTauri ? REDIRECT_URI : webRedirectUri(),
  });
  if (!isTauri) {
    // Web: leave for Dropbox; completeWebSignIn() finishes when we come back.
    startWebSignIn(appKey, verifier, `https://www.dropbox.com/oauth2/authorize?${params}`);
    return new Promise<string>(() => {});
  }
  return invoke<string>("dropbox_connect", {
    appKey,
    authUrl: `https://www.dropbox.com/oauth2/authorize?${params}`,
    verifier,
    redirectUri: REDIRECT_URI,
    port: REDIRECT_PORT,
  });
}

export async function disconnectDropbox(): Promise<void> {
  if (!isTauri) return webDisconnect();
  await invoke("dropbox_disconnect");
}

export class DropboxError extends Error {
  constructor(
    public status: number,
    public summary: string,
    public offline = false,
  ) {
    super(offline ? `Offline: ${summary}` : `Dropbox ${status}: ${summary}`);
  }
  /** e.g. "path/not_found", "path/conflict" */
  is(prefix: string) {
    return this.summary.startsWith(prefix);
  }
}

interface RawResponse {
  status: number;
  body: string;
  result: string | null;
}

async function request(kind: string, endpoint: string, arg?: unknown, body?: string): Promise<RawResponse> {
  let r: RawResponse;
  try {
    const argJson = arg === undefined ? null : JSON.stringify(arg);
    r = isTauri
      ? await invoke<RawResponse>("dropbox_request", { kind, endpoint, arg: argJson, body: body ?? null })
      : await webRequest(kind, endpoint, argJson, body ?? null);
  } catch (e) {
    const msg = String(e);
    throw new DropboxError(0, msg, msg.startsWith("offline"));
  }
  if (r.status === 429 || r.status >= 500) throw new DropboxError(r.status, "Dropbox is busy, will retry", true);
  if (r.status >= 400) {
    let summary = r.body;
    try {
      summary = JSON.parse(r.body).error_summary ?? r.body;
    } catch {}
    throw new DropboxError(r.status, summary);
  }
  return r;
}

export async function rpc<T = any>(endpoint: string, arg?: unknown): Promise<T> {
  const r = await request("rpc", endpoint, undefined, arg === undefined ? "null" : JSON.stringify(arg));
  return r.body ? JSON.parse(r.body) : (null as T);
}

export interface FileMeta {
  ".tag": "file";
  name: string;
  path_lower: string;
  path_display: string;
  rev: string;
}

export async function upload(path: string, content: string, rev: string | null): Promise<FileMeta> {
  const mode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
  const r = await request("upload", "files/upload", { path, mode, autorename: false, mute: true }, content);
  return JSON.parse(r.body);
}

export async function download(path: string): Promise<{ text: string; meta: FileMeta }> {
  const r = await request("download", "files/download", { path });
  return { text: r.body, meta: JSON.parse(r.result ?? "{}") };
}

/** Waits until something changes after `cursor` (or timeout). Doesn't need a token. */
export async function longpoll(cursor: string, timeout = 120): Promise<{ changes: boolean; backoff?: number }> {
  const r = await request("longpoll", "files/list_folder/longpoll", undefined, JSON.stringify({ cursor, timeout }));
  return JSON.parse(r.body);
}
