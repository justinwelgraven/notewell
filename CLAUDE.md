# Notewell: notes for Claude

A personal note-taking app (Evernote-style layout, UpNote-style simplicity) for Windows, macOS, iPhone (web) — built by Claude Code with Justin.
User-facing docs, setup and build steps: **README.md**.

## Stack
- **Tauri 2** desktop shell (`src-tauri/`, Rust) + **React 19 / TypeScript / Vite** UI (`src/`)
- Editor: **TipTap 3** (ProseMirror). Custom nodes/extensions in `src/editor/`
- The same UI also runs as a **web app / PWA** (iPhone): `isTauri` in `src/lib/storage.ts` switches platform code

## Layout of the code
- `src/App.tsx` — app state (notes, notebooks, views), keyboard shortcuts, sync wiring. Layout comes from
  `useLayoutMode()` in `src/lib/viewport.ts` (width + device orientation; iOS heights are unreliable):
  phone (one pane: width < 600, or touch + landscape + width < 900 = iPhone Duo folded sideways) · tablet (list + note,
  sidebar drawer, icon rail when ≥ 820 wide: iPhone Duo unfolded, iPad) · wide (three columns, ≥ 1100).
  CSS classes `.is-compact`, `.is-phone`, `.is-tablet`, `.has-rail` in `styles.css`.
- `src/components/` — Sidebar, NoteList, EditorPane, Toolbar, KeyboardBar (formatting above the iPhone keyboard), NoteActions (long-press / right-click menu), Rail (unfolded-sideways icon column), MarginControl (desktop text size & margins), QuickNote (Ctrl+Alt+N window), ShortcutsDialog, Menu (dropdowns/dialogs), Resizer
- `src/editor/` — LinkPreview + Embed nodes, SmartPaste (URL → card/player), Hashtags (#tag → tag), Shortcuts (Evernote keys), clipboardText (WhatsApp-friendly plain text on copy)
- `src/sync/` — Dropbox sync: `merge.ts` (pure rules, see tests idea below), `engine.ts` (pull/push/longpoll queue), `dropbox.ts` (API: native via Tauri commands, or fetch on web)
- `src/lib/gestures.ts` — edge-swipe (back / drawer), pull-to-sync, long-press; `src/lib/viewport.ts` — iPhone visible-area sizing; `src/lib/webUpdate.ts` — web update notice
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
- Web storage: IndexedDB stores `kv` (app data minus notes, key `notewell-meta`), `notes` (one entry per note; a save writes only
  notes whose object identity changed) and `images`. Older single-blob data (`notewell-data`) is migrated on load.
- Pictures (`src/lib/images.ts`, node `noteImage` in `src/editor/NoteImage.tsx`): the note holds only an id; the data URL lives in
  IndexedDB (also on desktop) and in Dropbox as `/images/<id>.dataurl` (text, because the Dropbox bridge only carries strings).
  Uploaded before notes; downloaded lazily when shown. List thumbnail = `nwimg:<id>`.
- Editor hands changes to App at most every 250 ms (`flush` in EditorPane; also on blur/hide/unmount and `notewell:flush-editor`).
  Outside changes (sync, quick note, restore) bump `rev` → content replaced in place, keeping cursor/keyboard (no remount).
- Star/pin change `updatedAt` by +1 ms so sync uploads them without reordering the list.
- Sync downloads/uploads 6 at a time (`pool` in engine.ts). Version history = Dropbox `files/list_revisions` + download `rev:<rev>`.
- Web link previews: Microlink API (desktop fetches pages natively). No preview (limit / blocked / offline) → simple card from
  the URL (`basicMeta`, status "basic"), retried for a full preview once per session.
- Tests: `npm test` (Vitest) — `src/sync/merge.test.ts` (sync + three-way merge), `src/lib/organize.test.ts` (tags, stacks).
  Both GitHub workflows run them before releasing/publishing.
- Tags/stacks: `src/lib/organize.ts`. Renaming/deleting a tag also rewrites `#tag` in note text (else Hashtags re-adds it).
  Notebook `stack` is synced through notebooks.json (the notebooks merge signature includes it).
- Note links: inline node `noteLink` (`src/editor/NoteLink.ts`, `[[` via @tiptap/suggestion); App supplies the note list
  (`setNoteLinkSource`) and handles `notewell:open-note`; backlinks via `linkedNoteIds` (cached per content object).
- Window keystroke tests: don't send keystrokes to the desktop app with SendKeys — they can land in the user's active window. Use the browser preview for UI/key tests.

## Releasing
- Git repo lives on the Windows PC only (`.git` is Dropbox-ignored). Commit + `git push` to `main` = release:
  GitHub Actions builds/signs Mac + Windows as `v0.1.<run>` (auto-update via `tauri-plugin-updater`, `latest.json` on GitHub releases),
  GitHub Pages (.github/workflows/web.yml) publishes the web app at https://justinwelgraven.github.io/notewell/.
  [web only] in the commit message skips the desktop release. Signing key: `notewell.key` in the project folder (Dropbox) or `~/.tauri/` (loaded by `scripts/tauri.mjs`; `*.key` is git-ignored — never commit it; GitHub secret `TAURI_SIGNING_PRIVATE_KEY`).
- Updater endpoint in `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` (GitHub user/repo).

## Current state (2026-11-26)
- Latest desktop release **v0.1.10** (Windows + Mac, auto-update). Latest web build **2026-11-26 14:05 UTC** (Settings → bottom shows the build).
- Justin uses: Windows PC (desktop app), MacBook, **iPhone Duo** (foldable; web version as Home Screen app — decided to stay on web, no native iOS app).
- Desktop: one-row toolbar (font choice removed; text size / align / indent in ⋯ More), "Text size & margins" panel, right-click note menu.
- Web/iPhone: phone + unfolded layouts, keyboard formatting bar, edge-swipe, pull-to-sync, long-press menu, icon rail, sync line,
  Dropbox sign-in by pasting a code in the Home Screen app, "new version → Reload" notice, note text 15px / 14.5px.
- **Open issue (iPhone Duo, Home Screen app):** after rotating while unfolded, iOS shrinks the app's window by 82pt (= safe-area top,
  subtracted twice) and clips anything below it: an empty band at the bottom. Readings in that state: inner/client/visual/svh/dvh 869,
  vh/lvh 951, screen 466×678, safe top 82 / bottom 34. Tried and **didn't work**: sizing to lvh (content clipped), auto-reload (still
  stale + flashing), remembered heights, status bar `black` (the Duo then put the app's top under the status-bar icons with inset 0).
  Now: `black-translucent` + safe-area insets + `.status-scrim` (dark strip behind the status bar). Fold/unfold or reopening resets it.
  Also tried (2026-11-26) and **didn't work**: rewriting the viewport meta after rotating to make WebKit recalculate (Justin:
  "still there"). Conclusion: an iOS bug in the Home Screen web view; not fixable from the page — don't retry these.
- iPhone Duo **folded upright**: the status bar is a vertical strip on the right (~75 pt wide, ~75–160 pt from the top) and iOS
  reports no inset. Detected as "Home Screen app + upright + touch + safe top 0" → `html.side-status` (viewport.ts); CSS gives
  the note list a clear right column and the note's topbar/toolbar right padding. (A tall header instead = big gap on top: rejected.)
- Sync merges notes edited on two devices (`src/sync/threeWay.ts`, base = last-synced Dropbox revision); pulls immediately on
  visibility/focus/online. Merge cases were tested in the browser, not yet with two real devices.
- iPhone touch targets: 44 pt height in compact layouts (toolbar buttons stay 36 wide so the toolbar keeps to two rows on a phone).
- GitHub's unauthenticated API is rate-limited (60/h): check releases via `releases/latest/download/latest.json` and the live site
  instead of polling `api.github.com`.

## Commands
- `npm install` (once per computer) · `npm run tauri dev` · `npm run tauri build` · `npm run build:web` (web app → `web/`)
- Type-check: `npx tsc --noEmit -p .`
