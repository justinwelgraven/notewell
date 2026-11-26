/**
 * iPhone (Safari / Home Screen app) sizing for the web version.
 *
 * iOS doesn't shrink the page when the keyboard opens (it slides the page up instead), so while typing
 * the app is sized to the *visible* area (window.visualViewport) to keep the toolbar on screen.
 * The visible-area height can be stale after rotating or folding, so it's only used while a text
 * field actually has focus; otherwise the best full-height reading is used. Re-checked every second.
 * Results go to --app-height / --app-top (used by .app in styles.css) and html.keyboard-open.
 *
 * iPhone Duo, Home Screen app: after rotating, iOS shrank the app's window by 82pt (the status-bar
 * inset subtracted a second time) and clips anything drawn below it — not fixable from the page.
 * (A solid "black" status bar was tried against that, but then the Duo put the app's top under the
 * status-bar icons without reporting an inset, so index.html is back to "black-translucent".)
 */
import { useEffect, useState } from "react";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "TEXTAREA" || (tag === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test((el as HTMLInputElement).type));
}

const isHomeScreen = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

/** Orientation as the device reports it (reliable, unlike heights). */
export function isPortrait(): boolean {
  const type = screen.orientation?.type;
  if (type) return type.startsWith("portrait");
  const angle = (window as unknown as { orientation?: number }).orientation;
  if (typeof angle === "number") return angle === 0 || angle === 180;
  return window.innerWidth <= window.innerHeight;
}

/** Measures a CSS length (e.g. "100lvh", "env(safe-area-inset-bottom)") in pixels. */
function cssLength(value: string, prop: "height" | "paddingTop" = "height"): number | null {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;visibility:hidden;";
  probe.style[prop] = value;
  document.body.appendChild(probe);
  const px = prop === "height" ? probe.getBoundingClientRect().height : parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(px) ? Math.round(px) : null;
}

/** Every height reading the browser offers, for choosing a height and for Screen info. */
export function heightReadings() {
  const vv = window.visualViewport;
  return {
    width: window.innerWidth,
    portrait: isPortrait(),
    inner: window.innerHeight,
    client: document.documentElement.clientHeight,
    visual: vv ? Math.round(vv.height) : null,
  };
}

/** Extra diagnostics shown in Settings → Screen info. */
export function extraReadings() {
  return {
    vh: cssLength("100vh"),
    svh: cssLength("100svh"),
    lvh: cssLength("100lvh"),
    dvh: cssLength("100dvh"),
    safeTop: cssLength("env(safe-area-inset-top, 0px)", "paddingTop"),
    safeBottom: cssLength("env(safe-area-inset-bottom, 0px)", "paddingTop"),
    homeScreen: isHomeScreen(),
    screen: `${screen.width}×${screen.height}`,
  };
}

/**
 * The app's full height when the keyboard is down. Not every reading goes stale at once on iOS, and
 * the orientation and width are reliable, so pick the reading that fits: in portrait the height must be
 * larger than the width, in landscape smaller.
 */
function fullHeight(): number {
  const r = heightReadings();
  // Note: on the iPhone Duo, CSS 100lvh can report the full screen (951) while iOS only shows 869 of
  // the window, so sizing to lvh hides the bottom of the app. Use the window readings only.
  const values = [r.visual, r.inner, r.client].filter((v): v is number => typeof v === "number" && v > 100);
  if (!values.length) return window.innerHeight;
  const fitting = values.filter((v) => (r.portrait ? v > r.width : v < r.width));
  if (fitting.length) return Math.max(...fitting);
  return r.portrait ? Math.max(...values) : Math.min(...values);
}

/** Scrolls the note so the text cursor is visible (with a little room around it). */
function keepCaretVisible() {
  const el = document.activeElement as HTMLElement | null;
  const sel = window.getSelection();
  if (!el?.isContentEditable || !sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  let rect: DOMRect | undefined = range.getClientRects()[0];
  if (!rect || (!rect.height && !rect.top)) {
    // Cursor on an empty line: use that line's box instead.
    const node = range.startContainer;
    const host = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
    rect = host?.getBoundingClientRect();
  }
  if (!rect) return;
  let scroller: HTMLElement | null = el;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const room = 32;
  if (rect.bottom > box.bottom - room) scroller.scrollTop += rect.bottom - box.bottom + room;
  else if (rect.top < box.top + room) scroller.scrollTop -= box.top + room - rect.top;
}

/**
 * Status bar on the side (iPhone Duo folded, upright, Home Screen app): the clock and network icons sit
 * in a vertical strip in the top-right corner, and iOS reports no safe-area inset for it. A normal
 * iPhone always reports a top inset there, so "Home Screen app, upright, touch, top inset 0" means
 * this strip: html.side-status then keeps the top-right corner clear (styles.css).
 */
function sideStatusStrip(envTop: number): boolean {
  return envTop === 0 && isHomeScreen() && isPortrait() && matchMedia("(pointer: coarse)").matches;
}

/**
 * iPhone Duo bottom band: after rotating, iOS can give the Home Screen app a window that's ~82 pt
 * shorter than the screen (100vh still reports the full height), leaving an empty band at the bottom.
 */
export const bandInfo = { seen: 0, nudged: 0, after: "–" };
function hasBottomBand(): boolean {
  if (!isHomeScreen() || isTyping()) return false;
  const vh = cssLength("100vh");
  const band = vh !== null && vh - window.innerHeight > 40;
  if (band) bandInfo.seen++;
  return band;
}

/** Rewrites the viewport settings (and puts them back), which makes WebKit recalculate the window. */
function nudgeViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  bandInfo.nudged++;
  const original = meta.content;
  meta.content = `${original}, shrink-to-fit=no`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      meta.content = original;
      window.scrollTo(0, 0);
    }),
  );
}

export function trackVisibleViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  root.classList.add("vv-tracked");

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const typing = isTyping();
      const full = fullHeight();
      const visible = vv ? vv.height : full;
      // Keyboard open = typing in a field AND the visible area is clearly shorter than the window.
      // (Never trust a visible height below 30% of the window: that's a stale value, not a keyboard.)
      const keyboard = !!vv && typing && full - visible > 120 && visible > full * 0.3;
      const height = keyboard ? visible : full;
      const top = keyboard ? vv!.offsetTop : 0;
      // Always compare with what's actually set, so any wrong state gets corrected.
      const h = `${Math.round(height)}px`;
      const t = `${Math.round(top)}px`;
      const changed = root.style.getPropertyValue("--app-height") !== h;
      if (changed) root.style.setProperty("--app-height", h);
      // The note area just got shorter (keyboard opened / resized): bring the cursor back into view,
      // otherwise it sits hidden under the keyboard until you type.
      if (keyboard && changed) requestAnimationFrame(keepCaretVisible);
      if (root.style.getPropertyValue("--app-top") !== t) root.style.setProperty("--app-top", t);
      if (root.classList.contains("keyboard-open") !== keyboard) root.classList.toggle("keyboard-open", keyboard);
      const side = sideStatusStrip(cssLength("env(safe-area-inset-top, 0px)", "paddingTop") ?? 0);
      if (root.classList.contains("side-status") !== side) root.classList.toggle("side-status", side);
      // Never let the page itself stay scrolled: everything scrolls inside the app.
      if (!keyboard && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
    });
  };

  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  // iOS reports the final size a little after rotating / folding: measure again shortly after.
  const settle = () => {
    update();
    setTimeout(update, 250);
    setTimeout(update, 700);
    setTimeout(update, 1500);
  };
  // After turning the phone: check for the iPhone Duo's bottom band once things have settled, and if
  // it's there, nudge iOS to recalculate the window (once per turn — never loops).
  const rotated = () => {
    settle();
    window.clearTimeout(bandTimer);
    bandTimer = window.setTimeout(() => {
      if (!hasBottomBand()) return;
      nudgeViewport();
      window.setTimeout(() => {
        bandInfo.after = hasBottomBand() ? "still there" : "fixed";
        settle();
      }, 900);
    }, 1000);
  };
  let bandTimer = 0;
  window.addEventListener("orientationchange", rotated);
  screen.orientation?.addEventListener?.("change", rotated);
  window.addEventListener("pageshow", settle);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && settle());
  document.addEventListener("focusin", settle);
  document.addEventListener("focusout", settle);
  // Safety net: re-check every second while visible (only writes when something changed).
  setInterval(() => document.visibilityState === "visible" && update(), 1000);
  update();
}

export type LayoutMode = "phone" | "tablet" | "wide";

/**
 * Which layout fits the screen, decided from the *width* and the device orientation (both reliable on
 * iOS; heights are not right after launching or rotating):
 *  - phone (one screen at a time): narrower than 600, or a touch screen held sideways narrower than 900
 *    (iPhone Duo folded and turned sideways — too small for two panels)
 *  - tablet (list + note): up to 1099 wide (iPhone Duo unfolded, iPad portrait, narrow window)
 *  - wide: the full three-column layout
 */
export function layoutMode(): LayoutMode {
  const w = window.innerWidth;
  const touch = matchMedia("(pointer: coarse)").matches;
  if (w < 600) return "phone";
  if (touch && !isPortrait() && w < 900) return "phone";
  if (w < 1100) return "tablet";
  return "wide";
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(layoutMode);
  useEffect(() => {
    const check = () => setMode(layoutMode());
    const late = () => {
      check();
      setTimeout(check, 300);
      setTimeout(check, 900);
    };
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", late);
    screen.orientation?.addEventListener?.("change", late);
    const t = setInterval(check, 1500);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", late);
      screen.orientation?.removeEventListener?.("change", late);
      clearInterval(t);
    };
  }, []);
  return mode;
}
