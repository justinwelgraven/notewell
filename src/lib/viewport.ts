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

const isHomeScreen = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

function isPortrait(): boolean {
  const type = screen.orientation?.type;
  if (type) return type.startsWith("portrait");
  const angle = (window as unknown as { orientation?: number }).orientation;
  if (typeof angle === "number") return angle === 0 || angle === 180;
  return window.innerWidth <= window.innerHeight;
}

/** Every height reading the browser offers (some of them go stale after rotating/folding on iOS). */
export function heightReadings() {
  const vv = window.visualViewport;
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  const portrait = isPortrait();
  const screenFits = Math.abs((portrait ? short : long) - window.innerWidth) <= 24;
  return {
    width: window.innerWidth,
    portrait,
    inner: window.innerHeight,
    client: document.documentElement.clientHeight,
    visual: vv ? Math.round(vv.height) : null,
    screen: isHomeScreen() && screenFits ? (portrait ? long : short) : null,
  };
}

/**
 * The app's full height when the keyboard is down.
 * iOS can keep an old height after rotating or folding (an empty band, or a squeezed app), but not every
 * reading goes stale at once. The orientation and width are reliable, so pick the reading that fits:
 * in portrait the height must be larger than the width, in landscape smaller.
 */
function fullHeight(): number {
  const r = heightReadings();
  const values = [r.screen, r.visual, r.inner, r.client].filter((v): v is number => typeof v === "number" && v > 100);
  if (!values.length) return window.innerHeight;
  if (r.screen && !isTyping()) return r.screen; // Home Screen app with a screen that matches: exact
  const fitting = values.filter((v) => (r.portrait ? v > r.width : v < r.width));
  if (fitting.length) return r.portrait ? Math.max(...fitting) : Math.max(...fitting);
  return r.portrait ? Math.max(...values) : Math.min(...values);
}

/*
 * iPhone Duo / iOS bug: after rotating, *every* height reading can be short by the same amount
 * (e.g. 587 instead of 669), leaving an empty band, while a fresh start gets it right. So in the
 * Home Screen app Notewell remembers the real height it saw for each screen width, notices when the
 * readings drop below it, uses the remembered height meanwhile, and reloads once (keeping your place).
 */
const LEARNED_KEY = "notewell-vp-heights";
const RELOAD_KEY = "notewell-vp-reloaded-at";
type Learned = Record<string, number>;
const readLearned = (): Learned => {
  try {
    return JSON.parse(localStorage.getItem(LEARNED_KEY) || "{}");
  } catch {
    return {};
  }
};
let learned: Learned = readLearned();
let staleSince = 0;
let staleHandler: (() => void) | null = null;

/** App registers what to do when the stale-height bug is detected (save, then reload). */
export function onStaleViewport(handler: () => void) {
  staleHandler = handler;
}

/** Remembered real height for a width (Home Screen app), for Screen info. */
export function learnedHeight(width: number): number | null {
  return learned[String(Math.round(width))] ?? null;
}

/** Returns the height to use, learning good values and flagging the stale-height bug. */
function checkLearned(measured: number, width: number, typing: boolean): number {
  if (!isHomeScreen() || typing) {
    staleSince = 0;
    return measured;
  }
  const key = String(Math.round(width));
  const known = learned[key];
  if (!known || measured >= known - 20) {
    staleSince = 0;
    if (!known || measured > known) {
      learned = { ...learned, [key]: measured };
      localStorage.setItem(LEARNED_KEY, JSON.stringify(learned));
    }
    return measured;
  }
  // Readings are clearly below what this screen really has: the iOS bug.
  if (!staleSince) staleSince = Date.now();
  const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - staleSince > 1200 && Date.now() - lastReload > 30000 && staleHandler) {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    staleSince = 0;
    staleHandler();
  }
  return known; // meanwhile, use the remembered real height
}

/**
 * After rotating, give WebKit a nudge to recompute its layout size: briefly rewriting the viewport
 * setting is a known way to clear its stale size on iOS.
 */
function nudgeViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.getAttribute("content") ?? "";
  meta.setAttribute("content", content + ", user-scalable=no");
  requestAnimationFrame(() => meta.setAttribute("content", content));
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
      const full = checkLearned(fullHeight(), window.innerWidth, typing);
      const visible = vv ? vv.height : full;
      // Keyboard open = typing in a field AND the visible area is clearly shorter than the window.
      // (Never trust a visible height below 30% of the window: that's a stale value, not a keyboard.)
      const keyboard = !!vv && typing && full - visible > 120 && visible > full * 0.3;
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
    nudgeViewport();
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
  const remeasure = () => {
    update();
    setTimeout(update, 250);
    setTimeout(update, 700);
  };
  document.addEventListener("focusin", remeasure);
  document.addEventListener("focusout", remeasure);
  // Safety net: re-check every second while visible (cheap: only writes when something changed).
  setInterval(() => document.visibilityState === "visible" && update(), 1000);
  update();
}
