/**
 * iPhone (Safari / Home Screen app) sizing for the web version.
 *
 * iOS doesn't shrink the page when the keyboard opens (it slides the page up instead), so while typing
 * the app is sized to the *visible* area (window.visualViewport) to keep the toolbar on screen.
 *
 * But visualViewport can report a stale, tiny height after rotating or folding/unfolding (iPhone Duo),
 * especially when the keyboard was open, and never correct it. So:
 *  - the visible-area height is only used while a text field actually has focus (keyboard really open);
 *    otherwise the full window height is used, which iOS does report correctly after a fold/rotation;
 *  - the size is re-checked every second, so a wrong value can never stick.
 * Results go to --app-height / --app-top (used by .app in styles.css) and html.keyboard-open.
 */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "TEXTAREA" || (tag === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test((el as HTMLInputElement).type));
}

export function trackVisibleViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  root.classList.add("vv-tracked");

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const full = window.innerHeight;
      const visible = vv ? vv.height : full;
      // Keyboard open = typing in a field AND the visible area is clearly shorter than the window.
      // (Never trust a visible height below 30% of the window: that's a stale value, not a keyboard.)
      const keyboard = !!vv && isTyping() && full - visible > 120 && visible > full * 0.3;
      const height = keyboard ? visible : full;
      const top = keyboard ? vv!.offsetTop : 0;
      // Always compare with what's actually set (not a cached value), so any wrong state gets corrected.
      const h = `${Math.round(height)}px`;
      const t = `${Math.round(top)}px`;
      if (root.style.getPropertyValue("--app-height") !== h) root.style.setProperty("--app-height", h);
      if (root.style.getPropertyValue("--app-top") !== t) root.style.setProperty("--app-top", t);
      if (root.classList.contains("keyboard-open") !== keyboard) root.classList.toggle("keyboard-open", keyboard);
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
  window.addEventListener("orientationchange", settle);
  screen.orientation?.addEventListener?.("change", settle);
  window.addEventListener("pageshow", settle);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && settle());
  // Focusing / leaving a field is what opens / closes the keyboard.
  document.addEventListener("focusin", settle);
  document.addEventListener("focusout", settle);
  // Safety net: re-check every second while visible (cheap: only writes when something changed).
  setInterval(() => document.visibilityState === "visible" && update(), 1000);
  update();
}
