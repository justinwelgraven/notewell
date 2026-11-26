import { getPrefs, MARGIN_PRESETS, NOTE_FONT, NOTE_MARGIN, setPrefs, usePrefs } from "../lib/prefs";
import { Icon } from "./Icon";
import { Dropdown } from "./Menu";

/**
 * Desktop: "Text size & margins" — default text size of notes and the empty space on both sides,
 * in one panel behind a single top-bar button. Remembered per computer.
 */
export default function MarginControl() {
  const { noteMargin, noteFontSize } = usePrefs();
  const setSize = (n: number) => setPrefs({ noteFontSize: Math.min(NOTE_FONT.max, Math.max(NOTE_FONT.min, n)) });
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <Dropdown
      trigger={<Icon name="margins" size={17} />}
      triggerClassName="ep-icon-btn ep-margins"
      align="right"
      title="Text size & margins"
    >
      {() => (
        <div className="margin-panel">
          <div className="menu-heading">Text size</div>
          <div className="size-row">
            <button className="size-step" onMouseDown={keep} onClick={() => setSize(getPrefs().noteFontSize - 1)} disabled={noteFontSize <= NOTE_FONT.min} aria-label="Smaller text">
              <span style={{ fontSize: 12 }}>A</span>
            </button>
            <input
              type="range"
              className="margin-slider"
              min={NOTE_FONT.min}
              max={NOTE_FONT.max}
              step={1}
              value={noteFontSize}
              aria-label="Text size"
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <button className="size-step" onMouseDown={keep} onClick={() => setSize(getPrefs().noteFontSize + 1)} disabled={noteFontSize >= NOTE_FONT.max} aria-label="Larger text">
              <span style={{ fontSize: 18 }}>A</span>
            </button>
          </div>
          <div className="size-value">
            {noteFontSize} px{noteFontSize === NOTE_FONT.default ? " (default)" : ""}
            {noteFontSize !== NOTE_FONT.default && (
              <button className="size-reset" onMouseDown={keep} onClick={() => setSize(NOTE_FONT.default)}>
                Reset
              </button>
            )}
          </div>

          <div className="menu-sep" />
          <div className="menu-heading">Side margins</div>
          <div className="margin-preview" aria-hidden="true">
            <span style={{ flexBasis: `${(noteMargin / NOTE_MARGIN.max) * 32}%` }} />
            <i />
            <span style={{ flexBasis: `${(noteMargin / NOTE_MARGIN.max) * 32}%` }} />
          </div>
          <input
            type="range"
            className="margin-slider"
            min={NOTE_MARGIN.min}
            max={NOTE_MARGIN.max}
            step={4}
            value={noteMargin}
            aria-label="Side margins"
            onChange={(e) => setPrefs({ noteMargin: Number(e.target.value) })}
          />
          <div className="margin-presets">
            {MARGIN_PRESETS.map(([label, px]) => (
              <button
                key={label}
                className={Math.abs(noteMargin - px) < 4 ? "is-active" : ""}
                onMouseDown={keep}
                onClick={() => setPrefs({ noteMargin: px })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
