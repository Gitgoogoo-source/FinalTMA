import { useCallback, useState, type ReactNode } from "react";
import { Outlet, useSearchParams } from "react-router-dom";

import { useNavigationIntent } from "../../workflows/payment-recovery/index.ts";
import { AppRecoveryCoordinator } from "../recovery/AppRecoveryCoordinator.tsx";
import { BottomNavigation } from "./BottomNavigation.tsx";
import { GlobalDialogs } from "./GlobalDialogs.tsx";
import { TopAssetBar, type GlobalDialog } from "./TopAssetBar.tsx";

export function AppShell(): ReactNode {
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
  return (
    <div className="app-shell">
      <AppRecoveryCoordinator
        openDialog={setDialog}
        closeDialogs={closeDialogs}
      />
      <TopAssetBar openDialog={openShellDialog} />
      <div className="content">
        <Outlet />
      </div>
      <BottomNavigation />
      <GlobalDialogs
        active={topupRequest ? "topup" : (requestedDialog ?? dialog)}
        topupRequest={topupRequest}
        close={closeDialogs}
      />
    </div>
  );
}
