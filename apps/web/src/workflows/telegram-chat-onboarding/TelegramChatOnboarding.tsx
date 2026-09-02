import { useEffect, type ReactNode } from "react";

import { useAppLocation } from "../../platform/navigation/index.tsx";
import { useSession } from "../../platform/session/store.ts";
import { telegram } from "../../platform/telegram/index.ts";
import {
  isFirstPlayablePageReady,
  subscribeFirstPlayablePageReady,
} from "../../shared/navigation/firstPlayablePageReadiness.ts";
import {
  isFirstScreenReady,
  subscribeFirstScreenReady,
} from "../../shared/navigation/firstScreenReadiness.ts";
import type { MainPagePath } from "../../shared/navigation/pageActivity.tsx";

let writeAccessRequestAttempted = false;

export default function TelegramChatOnboarding({
  deferred = false,
}: {
  deferred?: boolean;
}): ReactNode {
  const session = useSession();
  const location = useAppLocation();
  useEffect(() => {
    if (
      !session ||
      deferred ||
      session.accountStatus !== "normal" ||
      session.entryHandoffState !== "complete" ||
      !isMainPagePath(location.pathname)
    )
      return;
    const generation = session.generation;
    const path = location.pathname;
    const request = () => {
      requestTelegramWriteAccessOnce();
    };
    if (path === "/") {
      const unsubscribe = subscribeFirstScreenReady((readyGeneration) => {
        if (readyGeneration === generation) request();
      });
      if (isFirstScreenReady(generation)) request();
      return unsubscribe;
    }
    const unsubscribe = subscribeFirstPlayablePageReady(
      (readyGeneration, readyPath) => {
        if (readyGeneration === generation && readyPath === path) request();
      },
    );
    if (isFirstPlayablePageReady(generation, path)) request();
    return unsubscribe;
  }, [deferred, location.pathname, session]);
  return null;
}

function isMainPagePath(path: string): path is MainPagePath {
  return ["/", "/market", "/game", "/inventory", "/tasks"].includes(path);
}

function requestTelegramWriteAccessOnce(): void {
  if (writeAccessRequestAttempted) return;
  const app = telegram();
  if (app?.initDataUnsafe.user?.allows_write_to_pm === true) {
    writeAccessRequestAttempted = true;
    return;
  }
  if (
    !app?.requestWriteAccess ||
    !app.isVersionAtLeast ||
    !app.isVersionAtLeast("6.9")
  )
    return;
  writeAccessRequestAttempted = true;
  try {
    app.requestWriteAccess();
  } catch {
    // Telegram client capability failures must not block the game.
  }
}
