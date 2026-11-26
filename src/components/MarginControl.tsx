import { MARGIN_PRESETS, NOTE_MARGIN, setPrefs, usePrefs } from "../lib/prefs";
import { Icon } from "./Icon";
import { Dropdown } from "./Menu";

/** Desktop: adjusts the empty space on both sides of the note, for comfortable line lengths. */
export default function MarginControl() {
  const { noteMargin } = usePrefs();
  return (
    <Dropdown
      trigger={<Icon name="margins" size={17} />}
      triggerClassName="ep-icon-btn ep-margins"
      align="right"
      title="Note margins"
    >
      {() => (
        <div className="margin-panel">
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
                onMouseDown={(e) => e.preventDefault()}
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
