# Notewell: notes for Claude

A personal note-taking app (Evernote-style layout, UpNote-style simplicity) for Windows, macOS, iPhone (web) — built by Claude Code with Justin.
User-facing docs, setup and build steps: **README.md**.

## Stack
- **Tauri 2** desktop shell (`src-tauri/`, Rust) + **React 19 / TypeScript / Vite** UI (`src/`)
- Editor: **TipTap 3** (ProseMirror). Custom nodes/extensions in `src/editor/`
- The same UI also runs as a **web app / PWA** (iPhone): `isTauri` in `src/lib/storage.ts` switches platform code

## Layout of the code
- `src/App.tsx` — app state (notes, notebooks, views), keyboard shortcuts, sync wiring, screen-size layouts:
  `< 600px` phone / iPhone Duo folded (one pane at a time) · `600–1099px` iPhone Duo unfolded / iPad portrait / narrow window
  (list + note, sidebar drawer) · wider: three columns. CSS classes `.is-compact`, `.is-phone`, `.is-tablet` in `styles.css`.
- `src/components/` — Sidebar, NoteList, EditorPane, Toolbar, QuickNote (Ctrl+Alt+N window), ShortcutsDialog, Menu (dropdowns/dialogs), Resizer
- `src/editor/` — LinkPreview + Embed nodes, SmartPaste (URL → card/player), Hashtags (#tag → tag), Shortcuts (Evernote keys), clipboardText (WhatsApp-friendly plain text on copy)
- `src/sync/` — Dropbox sync: `merge.ts` (pure rules, see tests idea below), `engine.ts` (pull/push/longpoll queue), `dropbox.ts` (API: native via Tauri commands, or fetch on web)
- `src/lib/` — storage (load/save, desktop file vs browser IndexedDB), prefs (theme, copy style), keys (Ctrl vs ⌘ labels), util
- `src-tauri/src/lib.rs` — data file commands, link-preview page fetch, tray/menu bar, global shortcut, quick note window, close-to-tray, single instance
- `src-tauri/src/dropbox.rs` — Dropbox OAuth (PKCE, loopback http://localhost:53682/callback), token refresh, keychain storage, generic API request

## Decisions worth keeping
- Notes are one JSON file locally (`notewell-data.json` in the OS app-data dir); the **main window owns the data**. The quick-note window never writes the file; it sends notes to the main window via events.
- Dropbox layout: `/notes/<id>.json` per note + `/notebooks.json`. "Changed since sync" compares `updatedAt` **exactly** with the value recorded at last sync (`===`), never `<`/`>` — device clocks differ. Conflicts keep both versions ("(conflicted copy)").
- New installs create **no welcome note**, only a placeholder notebook (`placeholderNotebook`) that is dropped on first sync if Dropbox already has notebooks. `dedupeStarterNotebooks` merges duplicate "First Notebook"s from older versions into the oldest one (deterministic, no `updatedAt` change, so devices agree without conflicts).
- Icons: `app-icon.svg` (desktop, with margin + shadow) and `web-icon.svg` (edge-to-edge for iPhone). Regenerate with `npx tauri icon app-icon.svg` and `npx tauri icon web-icon.svg -o <tmp>` → copy into `public/icons/`.
- `npm run build` / `build:web` go through `scripts/vite-build.mjs`, which retries when Dropbox/antivirus briefly locks the output folder.
- Closing the main window hides it to the tray/menu bar; real quit goes through `quit_app` so the page saves first.
- Project folder lives in Dropbox: `node_modules`, `dist` are marked Dropbox-ignored by `scripts/dropbox-ignore.mjs` (preinstall). Rust build output goes outside the project via `scripts/tauri.mjs` (`npm run tauri ...`). Never build into the project folder.
- Window keystroke tests: don't send keystrokes to the desktop app with SendKeys — they can land in the user's active window. Use the browser preview for UI/key tests.

## Releasing
- Git repo lives on the Windows PC only (`.git` is Dropbox-ignored). Commit + `git push` to `main` = release:
  GitHub Actions builds/signs Mac + Windows as `v0.1.<run>` (auto-update via `tauri-plugin-updater`, `latest.json` on GitHub releases),
  GitHub Pages (.github/workflows/web.yml) publishes the web app at https://justinwelgraven.github.io/notewell/.
  [web only] in the commit message skips the desktop release. Signing key: `notewell.key` in the project folder (Dropbox) or `~/.tauri/` (loaded by `scripts/tauri.mjs`; `*.key` is git-ignored — never commit it; GitHub secret `TAURI_SIGNING_PRIVATE_KEY`).
- Updater endpoint in `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` (GitHub user/repo).

## Commands
- `npm install` (once per computer) · `npm run tauri dev` · `npm run tauri build` · `npm run build:web` (web app → `web/`)
- Type-check: `npx tsc --noEmit -p .`
