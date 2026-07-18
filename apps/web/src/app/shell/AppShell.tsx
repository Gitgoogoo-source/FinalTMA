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
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { child, records, text } from "../../shared/lib/data.ts";
import { Button } from "../../shared/ui/index.tsx";
import { TopupDialog } from "../../features/topup/TopupDialog.tsx";
import { VipDialog } from "../../features/vip/VipDialog.tsx";

const WalletDialog = lazy(() =>
  import("../../features/wallet/WalletDialog.tsx").then((module) => ({
    default: module.WalletDialog,
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
  const bootstrap = useApiQuery("me.bootstrap");
  const assets = useApiQuery("me.assets");
  const vip = useApiQuery("vip.status");
  const wallet = useApiQuery("wallet.status");
  const pendingPayments = useApiQuery("topup.status");
  const [dialog, setDialog] = useState<"topup" | "vip" | "wallet" | null>(null);
  const paymentRecoveryShown = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { blocked } = useOperation();
  const balances = child(assets.data, "assets");
  const kcoin = child(balances, "kcoin");
  const fgems = child(balances, "fgems");
  const user = child(bootstrap.data, "user");
  useEffect(() => {
    if (
      !paymentRecoveryShown.current &&
      records(pendingPayments.data?.payments).length > 0
    ) {
      paymentRecoveryShown.current = true;
      setDialog("topup");
    }
  }, [pendingPayments.data]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="identity">
          <span className="avatar">
            {text(user.first_name, "P").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{text(user.first_name, "—")}</strong>
            <small>@{text(user.username, text(user.id).slice(0, 8))}</small>
          </div>
        </div>
        <div className="asset-actions">
          <button onClick={() => setDialog("topup")}>
            <Coins />
            <span>{text(kcoin.available, assets.isLoading ? "…" : "—")}</span>
          </button>
          <button className="fgems">
            <i>◆</i>
            <span>{text(fgems.available, assets.isLoading ? "…" : "—")}</span>
          </button>
          {Boolean(vip.data?.active) && (
            <button className="active" onClick={() => setDialog("vip")}>
              <Crown />
            </button>
          )}
          <button
            className={wallet.data?.verified ? "active" : ""}
            onClick={() => setDialog("wallet")}
          >
            <WalletCards />
          </button>
          <Button
            className="refresh"
            aria-label="刷新真实状态"
            onClick={() => {
              void bootstrap.refetch();
              void assets.refetch();
              void vip.refetch();
              void wallet.refetch();
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
            disabled={blocked}
            onClick={() => navigate(path)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {dialog === "topup" && <TopupDialog close={() => setDialog(null)} />}
      {dialog === "vip" && <VipDialog close={() => setDialog(null)} />}
      {dialog === "wallet" && (
        <Suspense fallback={<div className="modal-backdrop">正在加载钱包</div>}>
          <WalletDialog close={() => setDialog(null)} />
        </Suspense>
      )}
    </div>
  );
}
