import { useRef, useState } from "react";
import type { AppData, View } from "../types";
import { isMac, kbd, QUICK_NOTE_KEYS } from "../lib/keys";
import { Icon } from "./Icon";
import { Dropdown, MenuItem } from "./Menu";
import { setPrefs, usePrefs, type Theme } from "../lib/prefs";
import { quitApp } from "../lib/storage";
import { relativeDate } from "../lib/util";
import ScreenInfo from "./ScreenInfo";
import type { SyncUi } from "../App";

interface Props {
  data: AppData;
  view: View;
  onView: (v: View) => void;
  search: string;
  onSearch: (s: string) => void;
  onNewNote: () => void;
  onNewNotebook: () => void;
  onRenameNotebook: (id: string) => void;
  onDeleteNotebook: (id: string) => void;
  allTags: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  width?: number;
  onQuickNote?: () => void;
  sync?: SyncUi;
  backup: BackupUi;
}

const THEMES: { value: Theme; label: string; colors: [string, string] }[] = [
  { value: "light", label: "Light", colors: ["#1a1a1a", "#ffffff"] },
  { value: "dark", label: "Dark", colors: ["#121212", "#212121"] },
  { value: "system", label: "System", colors: ["#1a1a1a", "linear-gradient(135deg, #ffffff 50%, #212121 50%)"] },
];

export function syncLabel(sync: SyncUi): string {
  if (!sync.dropbox.connected) return "Not syncing";
  const s = sync.status;
  if (!s || s.state === "syncing") return "Syncing…";
  if (s.state === "offline") return "Offline · will sync later";
  if (s.state === "error") return "Sync problem";
  return s.lastSync ? `Synced ${relativeDate(s.lastSync).toLowerCase()}` : "Synced";
}

function DropboxSection({ sync }: { sync: SyncUi }) {
  const [key, setKey] = useState(sync.dropbox.app_key ?? localStorage.getItem("notewell-dbx-key") ?? "");
  const [code, setCode] = useState("");
  const { dropbox, status } = sync;
  if (dropbox.connected) {
    return (
      <div className="dbx">
        <div className="dbx-row">
          <Icon name="cloud" size={16} />
          <div className="dbx-text">
            <strong>Dropbox connected</strong>
            <small>{dropbox.account ?? ""}</small>
            <small className={status?.state === "error" ? "dbx-err" : ""}>
              {status?.state === "error" ? status.message : syncLabel(sync)}
            </small>
          </div>
        </div>
        <div className="dbx-actions">
          {status?.state === "error" && /reconnect/i.test(status.message ?? "") ? (
            <button className="btn btn-primary btn-sm" onClick={sync.disconnect}>Reconnect</button>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={sync.syncNow}>
              <Icon name="refresh" size={13} /> Sync now
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={sync.disconnect}>Disconnect</button>
        </div>
      </div>
    );
  }
  if (sync.awaitingCode) {
    return (
      <div className="dbx">
        <div className="dbx-text">
          <strong>Almost there</strong>
          <small>Use the <b>Connect Dropbox</b> window: tap <b>Open Dropbox</b>, tap <b>Allow</b>, copy the code and paste it there (or here).</small>
        </div>
        <input
          className="modal-input dbx-input"
          placeholder="Paste the code from Dropbox"
          value={code}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {sync.error && <small className="dbx-err">{sync.error}</small>}
        <button className="btn btn-primary btn-sm" disabled={!code.trim() || sync.connecting} onClick={() => sync.submitCode(code)}>
          {sync.connecting ? "Connecting…" : "Finish connecting"}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => sync.connect(key)}>Open Dropbox again</button>
      </div>
    );
  }
  return (
    <div className="dbx">
      <div className="dbx-text">
        <small>Sync notes between your devices through your own Dropbox. Paste your Dropbox App key (see README for the 2-minute setup).</small>
      </div>
      <input
        className="modal-input dbx-input"
        placeholder="Dropbox App key"
        value={key}
        spellCheck={false}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {sync.error && <small className="dbx-err">{sync.error}</small>}
      <button
        className="btn btn-primary btn-sm"
        disabled={!key.trim() || sync.connecting}
        onClick={() => {
          localStorage.setItem("notewell-dbx-key", key.trim());
          sync.connect(key);
        }}
      >
        <Icon name="cloud" size={14} /> {sync.connecting ? "Waiting for Dropbox in your browser…" : "Connect Dropbox"}
      </button>
    </div>
  );
}

export interface BackupUi {
  exportBackup: () => void;
  exportMarkdown: () => void;
  restore: (file: File) => void;
}

function BackupSection({ backup }: { backup: BackupUi }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="menu-heading">Backup &amp; export</div>
      <MenuItem onSelect={backup.exportBackup}>
        <span className="menu-check"><Icon name="download" size={14} /></span>
        <span className="menu-toggle">
          Back up all notes
          <small>One file with every note and picture</small>
        </span>
      </MenuItem>
      <MenuItem onSelect={backup.exportMarkdown}>
        <span className="menu-check"><Icon name="note" size={14} /></span>
        <span className="menu-toggle">
          Export as text (Markdown)
          <small>Readable in any app</small>
        </span>
      </MenuItem>
      <MenuItem onSelect={() => fileRef.current?.click()}>
        <span className="menu-check"><Icon name="upload" size={14} /></span>
        <span className="menu-toggle">
          Restore from backup…
          <small>Adds missing notes; never deletes any</small>
        </span>
      </MenuItem>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) backup.restore(f);
        }}
      />
    </>
  );
}

function SettingsPanel({ onQuickNote, sync, backup }: { onQuickNote?: () => void; sync?: SyncUi; backup: BackupUi }) {
  const prefs = usePrefs();
  return (
    <div className="settings-panel">
      {sync && (
        <>
          <div className="menu-heading">Sync</div>
          <DropboxSection sync={sync} />
          <div className="menu-sep" />
        </>
      )}
      <div className="menu-heading">Theme</div>
      <div className="theme-seg">
        {THEMES.map((t) => (
          <button
            key={t.value}
            className={prefs.theme === t.value ? "is-active" : ""}
            onClick={() => setPrefs({ theme: t.value })}
          >
            <span className="theme-swatch">
              <i style={{ background: t.colors[0], flex: "0 0 30%" }} />
              <i style={{ background: t.colors[1] }} />
            </span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <BackupSection backup={backup} />
      <div className="menu-sep" />
      <MenuItem onSelect={() => window.dispatchEvent(new Event("notewell:shortcuts"))} shortcut={kbd("Ctrl+/")}>
        <span className="menu-check"><Icon name="more" size={14} /></span> Keyboard shortcuts
      </MenuItem>
      <div className="menu-sep" />
      <div className="menu-heading">Copying</div>
      <MenuItem onSelect={() => setPrefs({ waCopy: !prefs.waCopy })}>
        <span className="menu-check">{prefs.waCopy && <Icon name="check" size={14} />}</span>
        <span className="menu-toggle">
          WhatsApp-style formatting
          <small>Pastes *bold*, _italic_ and lists into chat apps</small>
        </span>
      </MenuItem>
      {onQuickNote && (
        <>
          <div className="menu-sep" />
          <MenuItem onSelect={onQuickNote} shortcut={QUICK_NOTE_KEYS}>
            <span className="menu-check"><Icon name="pencil" size={14} /></span> Quick note window
          </MenuItem>
          <div className="menu-sep" />
          <div className="menu-info menu-wrap">Closing the window keeps Notewell running in the {isMac ? "menu bar" : "system tray"}, so {QUICK_NOTE_KEYS} always works.</div>
          <MenuItem onSelect={() => quitApp()}>
            <span className="menu-check"><Icon name="x" size={14} /></span> Quit Notewell
          </MenuItem>
        </>
      )}
      <div className="menu-sep" />
      <ScreenInfo />
    </div>
  );
}

export default function Sidebar(p: Props) {
  const [nbOpen, setNbOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const live = p.data.notes.filter((n) => !n.trashedAt);
  const countIn = (id: string) => live.filter((n) => n.notebookId === id).length;
  const trashCount = p.data.notes.length - live.length;
  const is = (v: View) => JSON.stringify(v) === JSON.stringify(p.view);
  const notebooks = [...p.data.notebooks].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="sidebar" style={{ width: p.width }}>
      <div className="sb-account">
        <Dropdown
          trigger={
            <>
              <span className="sb-avatar">N</span>
              <span className="sb-account-name">Notewell</span>
              <Icon name="chevronDown" size={14} />
            </>
          }
          triggerClassName="sb-account-btn"
          title="Settings"
        >
          {() => <SettingsPanel onQuickNote={p.onQuickNote} sync={p.sync} backup={p.backup} />}
        </Dropdown>
      </div>

      <div className="sb-search">
        <Icon name="search" size={16} />
        <input
          ref={p.searchRef}
          placeholder="Search"
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && p.onSearch("")}
          spellCheck={false}
        />
        {p.search && (
          <button className="sb-search-clear" onClick={() => p.onSearch("")} title="Clear search">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      <div className="sb-new">
        <button className="sb-new-btn" onClick={p.onNewNote} title={`New note (${kbd("Ctrl+N")})`}>
          <Icon name="plus" size={18} />
          <span>New</span>
        </button>
        <Dropdown
          trigger={<Icon name="chevronDown" size={16} />}
          triggerClassName="sb-new-more"
          title="More options"
        >
          {(close) => (
            <>
              <MenuItem onSelect={() => { close(); p.onNewNote(); }} shortcut={kbd("Ctrl+N")}>Note</MenuItem>
              <MenuItem onSelect={() => { close(); p.onNewNotebook(); }}>Notebook</MenuItem>
              {p.onQuickNote && (
                <MenuItem onSelect={() => { close(); p.onQuickNote!(); }} shortcut={QUICK_NOTE_KEYS}>Quick note window</MenuItem>
              )}
            </>
          )}
        </Dropdown>
      </div>

      <nav className="sb-nav">
        <button className={`sb-item${is({ kind: "shortcuts" }) ? " is-active" : ""}`} onClick={() => p.onView({ kind: "shortcuts" })}>
          <Icon name="star" size={18} />
          <span>Shortcuts</span>
        </button>
        <button className={`sb-item${is({ kind: "all" }) ? " is-active" : ""}`} onClick={() => p.onView({ kind: "all" })}>
          <Icon name="note" size={18} />
          <span>Notes</span>
          <span className="sb-count">{live.length}</span>
        </button>

        <div className="sb-group">
          <div className="sb-item sb-group-head">
            <button className="sb-caret" onClick={() => setNbOpen((o) => !o)} title={nbOpen ? "Collapse" : "Expand"}>
              <Icon name={nbOpen ? "chevronDown" : "chevronRight"} size={14} />
            </button>
            <Icon name="notebook" size={18} />
            <span onClick={() => setNbOpen((o) => !o)}>Notebooks</span>
            <button className="sb-add" onClick={p.onNewNotebook} title="New notebook">
              <Icon name="plus" size={14} />
            </button>
          </div>
          {nbOpen &&
            notebooks.map((nb) => (
              <div
                key={nb.id}
                className={`sb-item sb-sub${is({ kind: "notebook", id: nb.id }) ? " is-active" : ""}`}
                onClick={() => p.onView({ kind: "notebook", id: nb.id })}
                onDoubleClick={() => p.onRenameNotebook(nb.id)}
              >
                <span className="sb-sub-name">{nb.name}</span>
                <span className="sb-count">{countIn(nb.id)}</span>
                <Dropdown trigger={<Icon name="more" size={14} />} triggerClassName="sb-sub-menu" align="right" title="Notebook actions">
                  {(close) => (
                    <>
                      <MenuItem onSelect={() => { close(); p.onRenameNotebook(nb.id); }}>Rename notebook</MenuItem>
                      <MenuItem
                        danger
                        onSelect={() => { close(); p.onDeleteNotebook(nb.id); }}
                      >
                        Delete notebook
                      </MenuItem>
                    </>
                  )}
                </Dropdown>
              </div>
            ))}
        </div>

        <div className="sb-group">
          <div className="sb-item sb-group-head" onClick={() => setTagsOpen((o) => !o)}>
            <span className="sb-caret">
              <Icon name={tagsOpen ? "chevronDown" : "chevronRight"} size={14} />
            </span>
            <Icon name="tag" size={18} />
            <span>Tags</span>
          </div>
          {tagsOpen &&
            (p.allTags.length === 0 ? (
              <div className="sb-empty">No tags yet</div>
            ) : (
              p.allTags.map((t) => (
                <button
                  key={t}
                  className={`sb-item sb-sub${is({ kind: "tag", tag: t }) ? " is-active" : ""}`}
                  onClick={() => p.onView({ kind: "tag", tag: t })}
                >
                  <span className="sb-sub-name">{t}</span>
                </button>
              ))
            ))}
        </div>

        <div className="sb-spacer" />

        <button className={`sb-item${is({ kind: "trash" }) ? " is-active" : ""}`} onClick={() => p.onView({ kind: "trash" })}>
          <Icon name="trash" size={18} />
          <span>Trash</span>
          {trashCount > 0 && <span className="sb-count">{trashCount}</span>}
        </button>
      </nav>
      {p.sync?.dropbox.connected && (
        <button
          className={`sb-sync sb-sync-${p.sync.status?.state ?? "syncing"}`}
          onClick={p.sync.syncNow}
          title={p.sync.status?.message ?? "Click to sync now"}
        >
          <Icon name={p.sync.status?.state === "offline" || p.sync.status?.state === "error" ? "cloudOff" : "cloud"} size={14} />
          <span>{syncLabel(p.sync)}</span>
        </button>
      )}
    </aside>
  );
}
