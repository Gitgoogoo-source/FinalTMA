import { useCallback, type ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import {
  useNavigationIntent,
  useNavigationIntentResume,
  useStarsPaymentRecovery,
} from "../../workflows/payment-recovery/index.ts";
import {
  useBlockingOperationRecovery,
  useRecoverableOperationDiscovery,
} from "../../workflows/operation-recovery/index.ts";
import type { GlobalDialog } from "../shell/TopAssetBar.tsx";

export function AppRecoveryCoordinator({
  openDialog,
  closeDialogs,
}: {
  openDialog(dialog: GlobalDialog): void;
  closeDialogs(): void;
}): ReactNode {
  const bootstrap = useApiQuery("identity.bootstrap");
  const pendingPayments = useApiQuery("topup.bootstrap");
  const { clearTopupRequest } = useNavigationIntent();
  const recoveryPayments = bootstrap.data?.payment_recovery_orders.length
    ? bootstrap.data.payment_recovery_orders
    : pendingPayments.data?.orders;
  const openPaymentRecovery = useCallback(
    (kind: "kcoin_topup" | "vip") =>
      openDialog(kind === "vip" ? "vip" : "topup"),
    [openDialog],
  );
  const resumeNavigation = useCallback(() => {
    clearTopupRequest();
    closeDialogs();
  }, [clearTopupRequest, closeDialogs]);
  useBlockingOperationRecovery(bootstrap.data?.blocking_operations);
  useRecoverableOperationDiscovery(bootstrap.data?.authority_cursor);
  useStarsPaymentRecovery(recoveryPayments, openPaymentRecovery);
  useNavigationIntentResume(pendingPayments.data?.orders, resumeNavigation);
  return null;
}
