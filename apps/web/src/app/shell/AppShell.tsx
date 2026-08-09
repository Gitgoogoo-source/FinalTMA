import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAppLocation } from "../../platform/navigation/index.tsx";
import { refreshForegroundState } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { useNavigationIntent } from "../../workflows/payment-recovery/context.ts";
import { RecoveryCoordinatorBoundary } from "../recovery/RecoveryCoordinatorBoundary.tsx";
import { PersistentPages } from "../router/PersistentPages.tsx";
import { getMainPagePath } from "../router/pageRoutes.ts";
import { BottomNavigation } from "./BottomNavigation.tsx";
import { GlobalDialogs } from "./GlobalDialogs.tsx";
import { TopAssetBar, type GlobalDialog } from "./TopAssetBar.tsx";

export function AppShell({
  standalonePage = null,
}: {
  standalonePage?: ReactNode;
}): ReactNode {
  const location = useAppLocation();
  const session = useSession();
  const activePath = getMainPagePath(location.pathname);
  const [dialog, setDialog] = useState<GlobalDialog | null>(null);
  const { topupRequest, clearTopupRequest } = useNavigationIntent();
  const openShellDialog = useCallback(
    (value: GlobalDialog) => {
      if (value === "topup") clearTopupRequest();
      setDialog(value);
    },
    [clearTopupRequest],
  );
  const closeDialogs = useCallback(() => {
    clearTopupRequest();
    setDialog(null);
  }, [clearTopupRequest]);
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(
      "data-app-shell-active",
      Boolean(activePath),
    );
    return () =>
      document.documentElement.removeAttribute("data-app-shell-active");
  }, [activePath]);
  useForegroundRefresh(session?.generation, location.pathname);
  return (
    <>
      <div
        className={`app-shell${activePath === "/inventory" ? " inventory-shell" : ""}`}
        data-app-shell-background
        hidden={!activePath}
        inert={!activePath}
      >
        <RecoveryCoordinatorBoundary
          openDialog={setDialog}
          closeDialogs={closeDialogs}
        />
        <TopAssetBar openDialog={openShellDialog} />
        <div className="content" data-app-scroll>
          <PersistentPages
            key={session?.generation}
            activePath={activePath}
            search={location.search}
          />
        </div>
        <BottomNavigation />
        <GlobalDialogs
          active={topupRequest ? "topup" : dialog}
          topupRequest={topupRequest}
          close={closeDialogs}
        />
      </div>
      {!activePath ? standalonePage : null}
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
