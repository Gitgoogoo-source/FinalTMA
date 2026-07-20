import { useCallback, type ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import { useMintRecovery } from "../../workflows/mint-recovery/index.ts";
import {
  useNavigationIntent,
  useNavigationIntentResume,
  useStarsPaymentRecovery,
} from "../../workflows/payment-recovery/index.ts";
import {
  useBlockingOperationRecovery,
  useGachaResultRecovery,
  useWheelResultRecovery,
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
  const recoveryPayments = bootstrap.data?.pending_payments.length
    ? bootstrap.data.pending_payments
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
  useGachaResultRecovery();
  useWheelResultRecovery();
  useMintRecovery(bootstrap.data?.pending_mints);
  useStarsPaymentRecovery(recoveryPayments, openPaymentRecovery);
  useNavigationIntentResume(pendingPayments.data?.orders, resumeNavigation);
  return null;
}
