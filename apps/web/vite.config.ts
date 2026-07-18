import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2023", sourcemap: false },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
