/**
 * Touch gestures for the phone / iPhone Duo layouts.
 * Home Screen web apps don't get Safari's own back-swipe or pull-to-refresh, so Notewell adds its own.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

const BACK_EDGE = 64; // px from the left edge of the note editor
const DRAWER_EDGE = 28; // px from the left edge of the note list
const SWIPE = 70; // px to travel before it counts

/** Swipe in from the left edge of `ref` → `onSwipe` (e.g. back to the list). The element follows the finger. */
export function useEdgeSwipe(ref: RefObject<HTMLElement | null>, onSwipe: () => void, enabled: boolean, slideAway = false) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let dx = 0;
    let dragging = false;
    let settling: Animation | null = null;
    let width = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = (commit: boolean) => {
      if (!start) return;
      start = null;
      if (!dragging) return;
      dragging = false;
      const target = commit && slideAway ? width : 0;
      const from = el.style.transform;
      const to = `translate3d(${target}px, 0, 0)`;
      const complete = () => {
        if (commit) cb.current();
      };
      if (!reduceMotion.matches && from && (slideAway || !commit)) {
        el.style.transform = to;
        settling = el.animate([{ transform: from }, { transform: to }], {
          duration: Math.min(240, 100 + 140 * Math.abs(target - dx) / width),
          easing: "cubic-bezier(.2,.7,.2,1)",
        });
        settling.onfinish = () => {
          settling = null;
          if (!target) el.style.transform = "";
          complete();
        };
      } else {
        el.style.transform = "";
        complete();
      }
    };
    const cancel = () => finish(false);
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      if (settling) return;
      const t = e.touches[0];
      const rect = el.getBoundingClientRect();
      if (t.clientX - rect.left >= (slideAway ? BACK_EDGE : DRAWER_EDGE)) return;
      width = rect.width;
      dx = 0;
      start = { x: t.clientX, y: t.clientY };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const x = t.clientX - start.x;
      const y = Math.abs(t.clientY - start.y);
      if (!dragging) {
        if (Math.max(Math.abs(x), y) < 8) return;
        if (x <= y) return cancel();
        dragging = true;
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.min(width, Math.max(0, x));
      if (!reduceMotion.matches) el.style.transform = `translate3d(${dx}px, 0, 0)`;
    };
    const up = () => finish(dx > SWIPE);
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", cancel);
      settling?.cancel();
      el.style.transform = "";
    };
  }, [ref, enabled, slideAway]);
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
