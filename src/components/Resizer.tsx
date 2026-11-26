import { useState } from "react";

/** Drag handle between two columns. Double-click resets to the default width. */
export function Resizer({
  width,
  min,
  max,
  defaultWidth,
  onChange,
  label,
}: {
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (w: number) => void;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add("is-resizing");
    const move = (ev: PointerEvent) => onChange(Math.round(Math.min(max, Math.max(min, startW + ev.clientX - startX))));
    const up = () => {
      setDragging(false);
      document.body.classList.remove("is-resizing");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div
      className={`resizer${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(defaultWidth)}
    />
  );
}

/** A number kept in localStorage (column widths). */
export function useStoredNumber(key: string, initial: number): [number, (n: number) => void] {
  const [value, setValue] = useState(() => {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : initial;
  });
  const set = (n: number) => {
    setValue(n);
    localStorage.setItem(key, String(n));
  };
  return [value, set];
}
