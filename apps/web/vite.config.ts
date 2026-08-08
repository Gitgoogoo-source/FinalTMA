import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { firstScreenBudgetPlugin } from "./vite/firstScreenBudget.ts";

export default defineConfig({
  plugins: [react(), firstScreenBudgetPlugin()],
  build: {
    target: "es2023",
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
