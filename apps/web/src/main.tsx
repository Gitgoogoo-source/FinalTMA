import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { AppProviders } from "./app/providers/AppProviders.tsx";
import { StartupScreen } from "./app/StartupScreen.tsx";
import {
  initializeLanguageHint,
  loadEnglishCatalog,
  tr,
} from "./platform/i18n/index.ts";
import { waitForTelegramSdk } from "./platform/telegram/sdk-ready.ts";
import { preloadFirstScreenContracts } from "@evomypet/api-contracts/app-client";
import "./shared/styles/foundation.css";

void import("./platform/audio/buttonClickAudio.ts").catch(() => undefined);
void loadEnglishCatalog().catch(() => undefined);
void preloadFirstScreenContracts().catch(() => undefined);
const root = document.getElementById("root");
if (!root) throw new Error("APP_ROOT_MISSING");
const reactRoot = createRoot(root);
reactRoot.render(
  <StartupScreen
    title={tr("Getting Your Adventure Ready", "正在准备冒险")}
    message={tr("Your companions are gathering.", "请稍候，伙伴们正在集合。")}
  />,
);

// Paint independently of the external SDK. Authentication must wait for it.
void waitForTelegramSdk()
  .then(async () => {
    const { initializeTelegram } =
      await import("./platform/telegram/initialize.ts");
    const telegram = initializeTelegram();
    initializeLanguageHint(telegram?.initDataUnsafe.user?.id);
    reactRoot.render(
      <StrictMode>
        <AppProviders>
          <App />
        </AppProviders>
      </StrictMode>,
    );
  })
  .catch(() => {
    // Do not include launch parameters, URLs with fragments, or user data.
    console.error("TELEGRAM_STARTUP_FAILED");
    reactRoot.render(
      <StartupScreen
        failed
        title={tr("Adventure Paused", "冒险暂时未能开启")}
        message={tr(
          "We couldn't open your adventure. Try again, or reopen EvoMyPet from Telegram.",
          "暂时没能开启冒险。请重试，或从 Telegram 重新打开 EvoMyPet。",
        )}
        retryLabel={tr("Try Again", "重新尝试")}
        onRetry={() => window.location.reload()}
      />,
    );
  });
