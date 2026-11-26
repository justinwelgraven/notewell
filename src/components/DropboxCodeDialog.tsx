import { useState } from "react";
import { Icon } from "./Icon";

/**
 * iPhone Home Screen app: connecting Dropbox with a code.
 * The "Open Dropbox" button is a real link the user taps: iOS only allows opening another page
 * directly from a tap (a pop-up opened by the app itself gets blocked).
 */
export default function DropboxCodeDialog({
  url,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  url: string;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [opened, setOpened] = useState(false);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal dbx-code" role="dialog" aria-label="Connect Dropbox">
        <h2>Connect Dropbox</h2>
        <ol className="dbx-steps">
          <li className={opened ? "is-done" : ""}>
            <a className="btn btn-primary dbx-open" href={url} target="_blank" rel="noopener" onClick={() => setOpened(true)}>
              <Icon name="external" size={15} /> Open Dropbox
            </a>
          </li>
          <li>
            Tap <b>Allow</b>, then copy the code Dropbox shows.
          </li>
          <li>
            Come back here (tap <b>Done</b> at the top of the Dropbox page) and paste the code:
          </li>
        </ol>
        <input
          className="modal-input"
          placeholder="Paste the code from Dropbox"
          value={code}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && code.trim() && onSubmit(code)}
        />
        {error && <p className="dbx-err dbx-code-err">That didn't work: {error.replace(/^Error:\s*/, "").slice(0, 140)}</p>}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!code.trim() || busy} onClick={() => onSubmit(code)}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
