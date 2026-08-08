import { useCallback, type ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import { useNavigationIntent } from "../../workflows/payment-recovery/context.ts";
import { useNavigationIntentResume } from "../../workflows/payment-recovery/useNavigationIntentResume.ts";
import { useStarsPaymentRecovery } from "../../workflows/payment-recovery/useStarsPaymentRecovery.ts";
import { useBlockingOperationRecovery } from "../../workflows/operation-recovery/useBlockingOperationRecovery.ts";
import { useRecoverableOperationDiscovery } from "../../workflows/operation-recovery/useRecoverableOperationDiscovery.ts";
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
