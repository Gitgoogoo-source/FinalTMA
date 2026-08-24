import { useEffectEvent, useLayoutEffect } from "react";

import {
  useAppLocation,
  useAppNavigate,
} from "../../platform/navigation/index.tsx";
import {
  setTelegramBackButtonVisible,
  subscribeTelegramBackButton,
} from "../../platform/telegram/index.ts";
import { useOperationNavigationLocked } from "../../workflows/operation-recovery/context.ts";

export function TelegramBackNavigation(): null {
  const { canGoBack } = useAppLocation();
  const navigate = useAppNavigate();
  const navigationLocked = useOperationNavigationLocked();
  const handleBack = useEffectEvent(() => {
    if (!canGoBack || navigationLocked) return;
    navigate(-1);
  });

  useLayoutEffect(() => {
    const unsubscribe = subscribeTelegramBackButton(handleBack);
    return () => {
      unsubscribe();
      setTelegramBackButtonVisible(false);
    };
  }, []);

  useLayoutEffect(() => {
    setTelegramBackButtonVisible(canGoBack);
  }, [canGoBack]);

  return null;
}
