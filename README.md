# Notewell

A simple note-taking app with an Evernote-style three-pane layout.
Built with [Tauri 2](https://tauri.app) (native shell) + React + [TipTap](https://tiptap.dev) (editor).

## Features
- Sidebar with Shortcuts, Notes, Notebooks, Tags and Trash; search across titles, text and tags
- Formatting: headers, fonts, sizes, colours, bold/italic/underline/strike, highlight, lists, checklists, links, alignment, quotes, code, dividers
- Spell check in English and Dutch together (right-click a misspelled word for suggestions, Add to dictionary or Ignore).
  Windows uses its own spell checker (install "Basic typing" for Dutch in Windows language settings); Mac and iPhone detect the language automatically
- Ctrl+A / ⌘A selects the whole note including the title; copying it puts the title in bold
- Pictures: paste a screenshot/photo, drag one in, or Insert → Picture (iPhone: the picture button above the keyboard). Large photos are shrunk; pictures sync through Dropbox (`/images/`)
- Pin notes to the top of the list (right-click / long-press a note, or the note's ⋯ menu)
- Search words are highlighted in the note list and in the open note
- Version history (note's ⋯ menu, with Dropbox): see and restore earlier versions of a note
- Backup & export (Settings): one backup file with every note and picture, a readable Markdown export, and "Restore from backup" (adds missing notes, never deletes)
- Trash empties itself after 30 days
- Links between notes: type `[[` and pick a note; the note you link to shows "Linked from" at the bottom
- Tags: rename or delete a tag everywhere (⋯ next to the tag in the sidebar, or double-click it)
- Notebook stacks: ⋯ next to a notebook → Add to stack… groups notebooks, Evernote-style
- Paste a website link → preview card (title, description, image). On the web/iPhone version the preview comes from Microlink (a public link-preview service, which sees the pasted link)
- Paste a YouTube or Spotify link → embedded player
- Ctrl+Shift+V pastes a link as plain text instead
- Light, dark or system theme (click "Notewell" at the top of the sidebar)
- Copying keeps lists, checklists and (optionally) WhatsApp-style *bold* / _italic_ in the plain text, so pasting into chat apps works
- Drag the column borders to resize; double-click a border to reset
- Ctrl+Alt+N anywhere in Windows opens a small always-on-top quick note window (while Notewell is running)
- Only one copy of the app runs at a time
- Notes saved locally, with automatic save and a backup copy

## Dropbox sync — one-time setup (about 2 minutes)
Notewell syncs through **your own** Dropbox, into the folder `Dropbox/Apps/<your app name>/`.
Each note is one small file, so edits on different devices don't clash.

1. Go to <https://www.dropbox.com/developers/apps> and click **Create app**.
2. Choose **Scoped access** → **App folder**, and give it a unique name (e.g. `Notewell-YourName`). Click **Create app**.
3. Open the **Permissions** tab, tick **files.metadata.read**, **files.content.read** and **files.content.write**, then click **Submit** at the bottom.
   (Do this *before* connecting — changed permissions only apply after reconnecting.)
4. Open the **Settings** tab:
   - under **OAuth 2 → Redirect URIs**, add `http://localhost:53682/callback` and click **Add**
   - check **Allow public clients (Implicit Grant & PKCE)** is set to **Allow**
   - copy the **App key** (the App secret is not needed)
5. In Notewell, click **Notewell** at the top of the sidebar → paste the App key → **Connect Dropbox** → approve in the browser.

Do the same last step on every device, with the same App key.

**How fast?** Changes are uploaded ~1.5 s after you stop typing, and other devices are told about
changes by Dropbox right away, so they usually appear within 2–5 seconds.
If the same note was changed on two devices before syncing, the newer version is kept and the other
is saved as "… (conflicted copy)" — nothing is lost.

## Shortcuts
Press **Ctrl+/** (⌘/ on Mac) in the app for the full list. Highlights:

| Windows | Mac | Action |
|---|---|---|
| Ctrl+N | ⌘N | New note |
| Ctrl+Alt+N | ⌥⌘N | Quick note window (works from any app) |
| Ctrl+Shift+N | ⇧⌘N | New notebook |
| Ctrl+F | ⌘F | Search notes |
| Ctrl+Shift+T | ⇧⌘T | Add a tag |
| `#word` | `#word` | Adds the tag "word" (Ctrl/⌘+click the hashtag to see all notes with it) |
| ↑ / ↓ in note list | ↑ / ↓ | Previous / next note |
| Delete / Backspace in note list | ⌫ | Move note to Trash (with Undo) |
| Esc in editor | Esc | Back to the note list |
| Ctrl+Shift+B / O / C | ⇧⌘B / O / C | Bulleted / numbered list / checklist |
| Ctrl+Enter | ⌘↩ | Tick checklist item (in quick note: save and close) |
| Ctrl+T | ⌘T | Strikethrough |
| Ctrl+Shift+H | ⇧⌘H | Highlight |
| Ctrl+K | ⌘K | Add / edit link |
| Ctrl+click | ⌘-click | Open a link |
| F11 | F11 | Focus mode |

## Where notes are stored
- Windows: `%APPDATA%\com.notewell.desktop\notewell-data.json`
- Mac: `~/Library/Application Support/com.notewell.desktop/notewell-data.json`

(plus a `.bak` backup of the previous save). Pictures are kept in the app's browser storage (IndexedDB) and in Dropbox.
Web/iPhone: everything in the browser's IndexedDB (one entry per note). The Dropbox sign-in is kept in Windows Credential Manager / the macOS Keychain.

## This project folder lives in Dropbox
`node_modules` and `dist` are marked as **ignored by Dropbox** (done automatically by `npm install`),
because each computer needs its own copy. Rust's build output is kept outside the project
(`%LOCALAPPDATA%\notewell-build` on Windows, `~/Library/Caches/notewell-build` on Mac).
Always run `npm install` once on a computer before building there.

## Build on Windows
Needs Node.js LTS, Rust (rustup) and Visual Studio Build Tools (C++).
```powershell
npm install
npm run tauri dev      # run the app with live reload
npm run tauri build    # installer → %LOCALAPPDATA%\notewell-build\release\bundle\nsis\
```

## Build on Mac
One-time setup in Terminal:
```bash
xcode-select --install                                           # Apple's command line tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
brew install node                                                # Node.js (or the installer from nodejs.org)
```
Then, in the project folder (in Dropbox):
```bash
npm install
npm run tauri build    # → ~/Library/Caches/notewell-build/release/bundle/dmg/Notewell_0.1.0_*.dmg
```
Open the `.dmg` and drag Notewell to Applications. Because the app isn't signed with an Apple Developer ID,
macOS blocks it the first time: **right-click Notewell → Open → Open** (only needed once).

On Mac, Notewell lives in the **menu bar** (top-right) when its window is closed; ⌥⌘N works from anywhere.

### Or let GitHub build it
`.github/workflows/build.yml` builds the Mac (Apple Silicon + Intel) and Windows versions on GitHub.
Push the project to a GitHub repository, open **Actions → Build Notewell → Run workflow**,
and download the results under **Artifacts**.

## Web version (iPhone)
The same app runs in Safari and can be added to the iPhone home screen. It syncs through the same Dropbox.

**Build it:** `npm run build:web` → the `web` folder (a handful of static files).

**Online at:** <https://justinwelgraven.github.io/notewell/> — published automatically by GitHub Pages
(`.github/workflows/web.yml`) on every push. Free, no ads or badges.

**Let Dropbox accept sign-ins from the web version:** in your Dropbox app (<https://www.dropbox.com/developers/apps>) → **Settings → Redirect URIs**,
add `https://justinwelgraven.github.io/notewell/` (with the trailing slash).
**On the iPhone:**
1. Open the address in **Safari**.
2. Tap **Share → Add to Home Screen**. Open Notewell from the home screen icon from now on (it then runs full-screen, and iOS keeps its data safe).
3. Tap ☰ → **Notewell** → paste the App key → **Connect Dropbox**.

Notes on the web version:
- The site itself contains no notes — they're only in your browser and your Dropbox, after you sign in.
- Link *preview cards* can't be fetched by a web page (browsers block reading other sites), so on the web a pasted link shows as a simple card with the site name; previews made on the desktop sync over fine. YouTube/Spotify players work.
- No quick-note shortcut or tray on the web, of course.

## Automatic updates
Every push to GitHub (`main`):
- **GitHub Actions** (`.github/workflows/build.yml`) builds Mac + Windows, numbers it `0.1.<build>` and publishes a release.
  Installed desktop apps check at startup and every 6 hours and show **"Restart to update"**.
- **GitHub Pages** rebuilds and publishes the web version (`.github/workflows/web.yml`).
  Put **[web only]** in a commit message to update just the web version without a new desktop release.

Updates are signed with the private key `notewell.key`, kept in this project folder in Dropbox (and in `%USERPROFILE%\.tauri\` on the PC). It is never committed to Git (`*.key` is ignored) —
**keep a backup of it** (e.g. in a password manager). Without it, installed apps can't be updated anymore and would need a reinstall.
The same key is stored as the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.

The Git repository lives on the Windows PC (`.git` is excluded from Dropbox to avoid corruption); GitHub is the shared copy.

## Roadmap
- Native iOS app (needs a Mac with Xcode and an Apple Developer account) — the web version covers the iPhone for now
