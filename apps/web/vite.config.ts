import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolveBattleModulePreloadDependencies } from "./vite/battleModulePreload.ts";
import { battleRuntimeBudgetPlugin } from "./vite/battleRuntimeBudget.ts";
import { firstScreenBudgetPlugin } from "./vite/firstScreenBudget.ts";

export default defineConfig({
  plugins: [react(), firstScreenBudgetPlugin(), battleRuntimeBudgetPlugin()],
  build: {
    target: "es2023",
    sourcemap: false,
    modulePreload: {
      polyfill: false,
      resolveDependencies: resolveBattleModulePreloadDependencies,
    },
  },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
