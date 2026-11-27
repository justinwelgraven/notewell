import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickNote from "./components/QuickNote";
import ErrorBoundary from "./components/ErrorBoundary";
import { isQuickWindow, isTauri } from "./lib/storage";
import { trackVisibleViewport } from "./lib/viewport";

// Web version: keep the app sized to the visible screen (iPhone keyboard, rotation, folding).
if (!isTauri) trackVisibleViewport();

// Web version: cache the app so it opens offline (not needed in the desktop app).
if (!isTauri && import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
import "./lib/prefs"; // applies light/dark theme
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary scope="app">{isQuickWindow() ? <QuickNote /> : <App />}</ErrorBoundary>
  </StrictMode>,
);
