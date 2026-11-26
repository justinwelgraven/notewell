import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Build time, shown in Settings, so it's easy to see which version a device is running.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC") },
  // Relative paths, so the web version works wherever it's hosted (domain root or a sub-folder).
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
