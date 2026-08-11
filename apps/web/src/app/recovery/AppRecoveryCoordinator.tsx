import { useCallback, type ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import { useIdentityRecovery } from "../../platform/session/store.ts";
import {
  useNavigationIntent,
  type GachaResumeAuthorization,
} from "../../workflows/payment-recovery/context.ts";
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
  const recovery = useIdentityRecovery();
  const pendingPayments = useApiQuery("topup.bootstrap");
  const { activateGachaResume, clearTopupRequest, topupRequest } =
    useNavigationIntent();
  const recoveryPayments =
    pendingPayments.data?.orders ?? recovery?.payment_recovery_orders;
  const openPaymentRecovery = useCallback(
    (kind: "kcoin_topup" | "vip") =>
      openDialog(kind === "vip" ? "vip" : "topup"),
    [openDialog],
  );
  const resumeNavigation = useCallback(
    (gachaResume: GachaResumeAuthorization | null) => {
      if (gachaResume) activateGachaResume(gachaResume);
      clearTopupRequest();
      closeDialogs();
    },
    [activateGachaResume, clearTopupRequest, closeDialogs],
  );
  useBlockingOperationRecovery(recovery?.blocking_operations);
  useRecoverableOperationDiscovery(recovery?.authority_cursor);
  useStarsPaymentRecovery(recoveryPayments, openPaymentRecovery);
  useNavigationIntentResume(
    pendingPayments.data?.orders,
    topupRequest,
    resumeNavigation,
  );
  return null;
}
