import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { AppProviders } from "./app/providers/AppProviders.tsx";
import {
  initializeLanguageHint,
  loadEnglishCatalog,
} from "./platform/i18n/index.ts";
import { initializeTelegram } from "./platform/telegram/index.ts";
import { preloadFirstScreenContracts } from "@pokepets/api-contracts/app-client";
import "./shared/styles/foundation.css";

const telegram = initializeTelegram();
initializeLanguageHint(telegram?.initDataUnsafe.user?.id);
void loadEnglishCatalog().catch(() => undefined);
void preloadFirstScreenContracts().catch(() => undefined);
const root = document.getElementById("root");
if (!root) throw new Error("APP_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
