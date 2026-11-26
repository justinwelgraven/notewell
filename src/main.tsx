import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickNote from "./components/QuickNote";
import { isQuickWindow, isTauri } from "./lib/storage";

// Web version: cache the app so it opens offline (not needed in the desktop app).
if (!isTauri && import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
import "./lib/prefs"; // applies light/dark theme
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isQuickWindow() ? <QuickNote /> : <App />}</StrictMode>,
);
