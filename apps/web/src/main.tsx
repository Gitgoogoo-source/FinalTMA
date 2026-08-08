import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { AppProviders } from "./app/providers/AppProviders.tsx";
import { initializeTelegram } from "./platform/telegram/index.ts";
import { preloadFirstScreenContracts } from "@pokepets/api-contracts/app-client";
import { preloadOperationRegistryProvider } from "./workflows/operation-recovery/provider-loader.ts";
import "./shared/styles/foundation.css";

initializeTelegram();
void preloadFirstScreenContracts().catch(() => undefined);
void preloadOperationRegistryProvider().catch(() => undefined);
const root = document.getElementById("root");
if (!root) throw new Error("APP_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
