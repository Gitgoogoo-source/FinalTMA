import { useCallback, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";

import { useNavigationIntent } from "../../workflows/payment-recovery/index.ts";
import { AppRecoveryCoordinator } from "../recovery/AppRecoveryCoordinator.tsx";
import { BottomNavigation } from "./BottomNavigation.tsx";
import { GlobalDialogs } from "./GlobalDialogs.tsx";
import { TopAssetBar, type GlobalDialog } from "./TopAssetBar.tsx";

export function AppShell(): ReactNode {
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
        active={topupRequest ? "topup" : dialog}
        topupRequest={topupRequest}
        close={closeDialogs}
      />
    </div>
  );
}
