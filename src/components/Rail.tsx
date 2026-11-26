import type { View } from "../types";
import { Icon } from "./Icon";

interface Props {
  view: View;
  onView: (v: View) => void;
  onMenu: () => void;
  onSearch: () => void;
  onNewNote: () => void;
}

/**
 * iPhone Duo unfolded and turned sideways (or iPad): a slim always-visible column of icons,
 * instead of hiding everything behind the ☰ drawer. Notebooks and Tags open the drawer, where the lists are.
 */
export default function Rail(p: Props) {
  const is = (k: View["kind"]) => p.view.kind === k;
  const item = (icon: string, label: string, active: boolean, onClick: () => void) => (
    <button className={`rail-btn${active ? " is-active" : ""}`} onClick={onClick} title={label} aria-label={label}>
      <Icon name={icon} size={21} />
    </button>
  );
  return (
    <nav className="rail" aria-label="Navigation">
      {item("menu", "Menu", false, p.onMenu)}
      <button className="rail-new" onClick={p.onNewNote} title="New note" aria-label="New note">
        <Icon name="plus" size={22} />
      </button>
      {item("search", "Search", false, p.onSearch)}
      {item("star", "Shortcuts", is("shortcuts"), () => p.onView({ kind: "shortcuts" }))}
      {item("note", "Notes", is("all"), () => p.onView({ kind: "all" }))}
      {item("notebook", "Notebooks", is("notebook"), p.onMenu)}
      {item("tag", "Tags", is("tag"), p.onMenu)}
      <div className="rail-spacer" />
      {item("trash", "Trash", is("trash"), () => p.onView({ kind: "trash" }))}
    </nav>
  );
}
