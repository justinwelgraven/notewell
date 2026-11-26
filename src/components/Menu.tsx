import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that toggles a small dropdown panel; closes on outside click or Escape. */
export function Dropdown({
  trigger,
  children,
  className,
  title,
  align = "left",
  triggerClassName = "tb-btn",
  disabled,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  title?: string;
  align?: "left" | "right";
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        className={`${triggerClassName}${open ? " is-open" : ""}`}
        title={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && <div className={`dropdown-panel align-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  active,
  danger,
  shortcut,
}: {
  children: ReactNode;
  onSelect: () => void;
  active?: boolean;
  danger?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className={`menu-item${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      <span className="menu-item-label">{children}</span>
      {shortcut && <span className="menu-item-shortcut">{shortcut}</span>}
    </button>
  );
}

/** Small modal with a single text field (used for links, notebook names). */
export function PromptDialog({
  title,
  label,
  initial = "",
  placeholder,
  confirmText = "OK",
  onConfirm,
  onCancel,
  suggestions,
}: {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  /** Choices offered while typing (e.g. existing stack names). */
  suggestions?: string[];
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const submit = () => {
    const v = value.trim();
    if (v) onConfirm(v);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {label && <label className="modal-label">{label}</label>}
        <input
          ref={inputRef}
          className="modal-input"
          value={value}
          placeholder={placeholder}
          list={suggestions?.length ? "prompt-suggestions" : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        {!!suggestions?.length && (
          <datalist id="prompt-suggestions">
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim()}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} autoFocus>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
