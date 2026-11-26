/**
 * Web version: notices when a newer version of Notewell has been published (GitHub Pages) and downloaded
 * in the background by the service worker, so the app can offer "Reload" instead of the user having to
 * close and reopen it (twice) on the iPhone.
 */
export function watchWebUpdates(onUpdateReady: () => void): () => void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return () => {};
  let reg: ServiceWorkerRegistration | undefined;
  const hadController = !!navigator.serviceWorker.controller;

  // A new service worker taking over means new app files are ready.
  const onControllerChange = () => {
    if (hadController) onUpdateReady();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

  // Look for a new version when the app comes back to the foreground, and every 30 minutes.
  const check = () => reg?.update().catch(() => {});
  const onVisible = () => document.visibilityState === "visible" && check();
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, 30 * 60 * 1000);
  navigator.serviceWorker.getRegistration().then((r) => (reg = r));

  return () => {
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}
