/**
 * iPhone (Safari / home-screen app) fixes for the web version.
 *
 * iOS doesn't shrink the page when the keyboard opens: it slides the whole page up, so the
 * toolbar scrolls out of view. After rotating or folding/unfolding (iPhone Duo) it can also keep
 * a stale height, cutting off the bottom of the app.
 *
 * So the app is sized to the *visible* area (window.visualViewport) and re-measured on every
 * keyboard, rotation and fold change: --app-height / --app-top are used by .app in styles.css.
 */
export function trackVisibleViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  root.classList.add("vv-tracked");

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-top", `${Math.round(top)}px`);
      // Keyboard counts as open when it takes a real chunk of the screen.
      root.classList.toggle("keyboard-open", !!vv && window.innerHeight - vv.height > 120);
      // Never let the page itself stay scrolled: everything scrolls inside the app.
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
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
  };
  window.addEventListener("orientationchange", settle);
  screen.orientation?.addEventListener?.("change", settle);
  window.addEventListener("pageshow", settle);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && settle());
  // Focusing a field is what opens the keyboard.
  document.addEventListener("focusin", settle);
  document.addEventListener("focusout", settle);
  update();
}
