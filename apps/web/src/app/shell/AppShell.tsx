import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";

import { refreshForegroundState } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { useNavigationIntent } from "../../workflows/payment-recovery/index.ts";
import { AppRecoveryCoordinator } from "../recovery/AppRecoveryCoordinator.tsx";
import { PersistentPages } from "../router/PersistentPages.tsx";
import { getMainPagePath } from "../router/pageRoutes.ts";
import { BottomNavigation } from "./BottomNavigation.tsx";
import { GlobalDialogs } from "./GlobalDialogs.tsx";
import { TopAssetBar, type GlobalDialog } from "./TopAssetBar.tsx";

export function AppShell(): ReactNode {
  const location = useLocation();
  const session = useSession();
  const activePath = getMainPagePath(location.pathname);
  const [dialog, setDialog] = useState<GlobalDialog | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { topupRequest, clearTopupRequest } = useNavigationIntent();
  const requestedDialog =
    searchParams.get("dialog") === "wallet" ? "wallet" : null;
  const clearDialogRequest = useCallback(() => {
    if (!searchParams.has("dialog")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("dialog");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const openShellDialog = useCallback(
    (value: GlobalDialog) => {
      clearDialogRequest();
      if (value === "topup") clearTopupRequest();
      setDialog(value);
    },
    [clearDialogRequest, clearTopupRequest],
  );
  const closeDialogs = useCallback(() => {
    clearTopupRequest();
    setDialog(null);
    clearDialogRequest();
  }, [clearDialogRequest, clearTopupRequest]);
  useForegroundRefresh(session?.generation, location.pathname);
  return (
    <>
      <div className="app-shell" hidden={!activePath} inert={!activePath}>
        <AppRecoveryCoordinator
          openDialog={setDialog}
          closeDialogs={closeDialogs}
        />
        <TopAssetBar openDialog={openShellDialog} />
        <div className="content">
          <PersistentPages
            key={session?.generation}
            activePath={activePath}
            search={location.search}
          />
        </div>
        <BottomNavigation />
        <GlobalDialogs
          active={topupRequest ? "topup" : (requestedDialog ?? dialog)}
          topupRequest={topupRequest}
          close={closeDialogs}
        />
      </div>
      {!activePath ? <Outlet /> : null}
    </>
  );
}

function useForegroundRefresh(
  generation: string | undefined,
  pathname: string,
): void {
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    hiddenAt.current =
      document.visibilityState === "hidden" || telegram()?.isActive === false
        ? Date.now()
        : null;
  }, [generation]);
  useEffect(() => {
    const markInactive = () => {
      hiddenAt.current ??= Date.now();
    };
    const refresh = () => {
      void refreshForegroundState(pathname).catch(() => undefined);
    };
    const restore = () => {
      const started = hiddenAt.current;
      hiddenAt.current = null;
      if (started !== null && Date.now() - started >= 300_000) refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markInactive();
        return;
      }
      restore();
    };
    const reconnect = () => refresh();
    const app = telegram();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", reconnect);
    app?.onEvent("deactivated", markInactive);
    app?.onEvent("activated", restore);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", reconnect);
      app?.offEvent("deactivated", markInactive);
      app?.offEvent("activated", restore);
    };
  }, [generation, pathname]);
}
