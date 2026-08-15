import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { GlobalDialog } from "../shell/TopAssetBar.tsx";
import {
  loadRecoveryCoordinator,
  type RecoveryCoordinatorModule,
} from "./coordinator-loader.ts";
import { t } from "../../platform/i18n/index.ts";

export function RecoveryCoordinatorBoundary({
  openDialog,
  closeDialogs,
}: {
  openDialog(dialog: GlobalDialog): void;
  closeDialogs(): void;
}): ReactNode {
  const [loaded, setLoaded] = useState<RecoveryCoordinatorModule | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    void loadRecoveryCoordinator()
      .then((module) => {
        setLoaded(module);
        setFailed(false);
      })
      .catch(() => {
        setLoaded(null);
        setFailed(true);
      });
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("online", load);
    return () => window.removeEventListener("online", load);
  }, [load]);
  if (loaded) {
    const Coordinator = loaded.AppRecoveryCoordinator;
    return <Coordinator openDialog={openDialog} closeDialogs={closeDialogs} />;
  }
  return failed ? (
    <button className="operation-resume" type="button" onClick={load}>
      {t("恢复未完成操作")}
    </button>
  ) : null;
}
