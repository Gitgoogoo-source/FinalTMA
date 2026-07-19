import {
  Boxes,
  Coins,
  Crown,
  Gamepad2,
  ListChecks,
  PackageSearch,
  RefreshCw,
  ShoppingBasket,
  WalletCards,
} from "lucide-react";
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useApiQuery } from "../../platform/query/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { TopupDialog } from "../../domains/topup/index.ts";
import { VipDialog } from "../../domains/vip/index.ts";
import { useMintRecovery } from "../../workflows/mint-recovery/index.ts";
import {
  useNavigationIntent,
  useNavigationIntentResume,
} from "../../workflows/navigation-intent-resume/index.ts";
import { useBlockingOperationRecovery } from "../../workflows/operation-recovery/index.ts";
import { useStarsPaymentRecovery } from "../../workflows/stars-payment-recovery/index.ts";

const WalletDialog = lazy(() =>
  import("../../domains/wallet/index.ts").then((module) => ({
    default: module.WalletCapabilityDialog,
  })),
);

const navigation = [
  { path: "/market", label: "交易", icon: ShoppingBasket },
  { path: "/game", label: "游戏", icon: Gamepad2 },
  { path: "/", label: "开盒", icon: Boxes },
  { path: "/inventory", label: "藏品", icon: PackageSearch },
  { path: "/tasks", label: "任务", icon: ListChecks },
];

export function AppShell(): ReactNode {
  const bootstrap = useApiQuery("identity.bootstrap");
  const vip = useApiQuery("vip.get");
  const pendingPayments = useApiQuery("topup.bootstrap");
  const [dialog, setDialog] = useState<"topup" | "vip" | "wallet" | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { topupRequest, clearTopupRequest } = useNavigationIntent();
  const activeDialog = topupRequest ? "topup" : dialog;
  const openPaymentRecovery = useCallback(
    (kind: "kcoin_topup" | "vip") =>
      setDialog(kind === "vip" ? "vip" : "topup"),
    [],
  );
  const recoveryPayments = bootstrap.data?.pending_payments.length
    ? bootstrap.data.pending_payments
    : pendingPayments.data?.orders;
  const resumeNavigation = useCallback(() => {
    clearTopupRequest();
    setDialog(null);
  }, [clearTopupRequest]);
  useBlockingOperationRecovery(bootstrap.data?.blocking_operations);
  useMintRecovery(bootstrap.data?.pending_mints);
  useStarsPaymentRecovery(recoveryPayments, openPaymentRecovery);
  useNavigationIntentResume(pendingPayments.data?.orders, resumeNavigation);
  const kcoin = bootstrap.data?.assets.kcoin;
  const fgems = bootstrap.data?.assets.fgems;
  const user = bootstrap.data?.user;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="identity">
          <span className="avatar">
            {(user?.first_name ?? "P").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user?.first_name ?? "—"}</strong>
            <small>@{user?.username ?? user?.id.slice(0, 8) ?? "—"}</small>
          </div>
        </div>
        <div className="asset-actions">
          <button
            onClick={() => {
              clearTopupRequest();
              setDialog("topup");
            }}
          >
            <Coins />
            <span>{kcoin?.available ?? (bootstrap.isLoading ? "…" : "—")}</span>
          </button>
          <button className="fgems">
            <i>◆</i>
            <span>{fgems?.available ?? (bootstrap.isLoading ? "…" : "—")}</span>
          </button>
          {Boolean(vip.data?.active) && (
            <button className="active" onClick={() => setDialog("vip")}>
              <Crown />
            </button>
          )}
          <button onClick={() => setDialog("wallet")}>
            <WalletCards />
          </button>
          <Button
            className="refresh"
            aria-label="刷新真实状态"
            onClick={() => {
              void bootstrap.refetch();
              void vip.refetch();
              void pendingPayments.refetch();
            }}
          >
            <RefreshCw />
          </Button>
        </div>
      </header>
      <div className="content">
        <Outlet />
      </div>
      <nav className="bottom-nav">
        {navigation.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            className={
              (
                path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(path)
              )
                ? "active"
                : ""
            }
            onClick={() => navigate(path)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {activeDialog === "topup" && (
        <TopupDialog
          request={topupRequest}
          close={() => {
            clearTopupRequest();
            setDialog(null);
          }}
        />
      )}
      {activeDialog === "vip" && <VipDialog close={() => setDialog(null)} />}
      {activeDialog === "wallet" && (
        <Suspense fallback={<div className="modal-backdrop">正在加载钱包</div>}>
          <WalletDialog close={() => setDialog(null)} />
        </Suspense>
      )}
    </div>
  );
}
