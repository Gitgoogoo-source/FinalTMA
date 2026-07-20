import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { AppProviders } from "./app/providers/AppProviders.tsx";
import { initializeTelegram } from "./platform/telegram/index.ts";
import "./shared/styles/global.css";

initializeTelegram();
const root = document.getElementById("root");
if (!root) throw new Error("APP_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
