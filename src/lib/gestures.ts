/**
 * Touch gestures for the phone / iPhone Duo layouts.
 * Home Screen web apps don't get Safari's own back-swipe or pull-to-refresh, so Notewell adds its own.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

const EDGE = 28; // px from the left edge where a back-swipe may start
const SWIPE = 70; // px to travel before it counts

/** Swipe in from the left edge of `ref` → `onSwipe` (e.g. back to the list). The element follows the finger. */
export function useEdgeSwipe(ref: RefObject<HTMLElement | null>, onSwipe: () => void, enabled: boolean) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let dx = 0;
    const reset = () => {
      el.style.transition = "transform 0.18s ease-out";
      el.style.transform = "";
      start = null;
      dx = 0;
    };
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t.clientX - el.getBoundingClientRect().left < EDGE) {
        start = { x: t.clientX, y: t.clientY };
        el.style.transition = "none";
      }
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      dx = t.clientX - start.x;
      if (Math.abs(t.clientY - start.y) > 60 && dx < SWIPE) return reset(); // that's a scroll
      if (dx > 0) el.style.transform = `translateX(${dx * 0.7}px)`;
    };
    const up = () => {
      if (!start) return;
      const done = dx > SWIPE;
      reset();
      if (done) cb.current();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", reset);
    };
  }, [ref, enabled]);
}

/** Pull down on a scroll area that's at the top → `onRefresh`. Returns how far it's pulled (for the indicator). */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => void, enabled: boolean): number {
  const [pull, setPull] = useState(0);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    let dist = 0;
    const down = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (dist) setPull(0);
        dist = 0;
        return;
      }
      dist = Math.min(dy * 0.5, 96);
      setPull(dist);
    };
    const up = () => {
      if (startY !== null && dist >= PULL_TRIGGER) cb.current();
      startY = null;
      dist = 0;
      setPull(0);
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
  }, [ref, enabled]);
  return pull;
}
export const PULL_TRIGGER = 64;

/**
 * Press-and-hold on touch screens (and right-click with a mouse) → `onMenu`.
 * Returns props to spread on the element, plus `consumeClick()` to ignore the tap that ends a long-press.
 */
export function useLongPress(onMenu: (id: string, at: { x: number; y: number } | null) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const menuRef = useRef(onMenu);
  menuRef.current = onMenu;
  // The same object every render, so memoized list cards that receive it don't redraw.
  const stable = useRef<ReturnType<typeof makeLongPress> | null>(null);
  stable.current ??= makeLongPress(timer, start, fired, (id, at) => menuRef.current(id, at));
  return stable.current;
}

function makeLongPress(
  timer: { current: number | undefined },
  start: { current: { x: number; y: number } | null },
  fired: { current: boolean },
  onMenu: (id: string, at: { x: number; y: number } | null) => void,
) {
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    bind: (id: string) => ({
      onTouchStart: (e: React.TouchEvent) => {
        fired.current = false;
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          // Only the tap that ends this press is ignored; if the browser doesn't send one, forget it soon.
          window.setTimeout(() => (fired.current = false), 800);
          navigator.vibrate?.(10);
          onMenu(id, null);
        }, 480);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 10) cancel();
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        cancel();
        // Touch long-press already opened it; a mouse right-click opens it at the pointer.
        if (!fired.current) onMenu(id, { x: e.clientX, y: e.clientY });
      },
    }),
    /** True (once) if the click that's happening is the end of a long-press. */
    consumeClick: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
