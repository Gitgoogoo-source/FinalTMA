import { Coins, Crown, RefreshCw, WalletCards } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";
import { Button } from "../../shared/ui/index.tsx";

export type GlobalDialog = "topup" | "vip" | "wallet";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const bootstrap = useApiQuery("identity.bootstrap");
  const vip = useApiQuery("vip.get");
  const pendingPayments = useApiQuery("topup.bootstrap");
  const kcoin = bootstrap.data?.assets.kcoin;
  const fgems = bootstrap.data?.assets.fgems;
  const user = bootstrap.data?.user;
  return (
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
        <button onClick={() => openDialog("topup")}>
          <Coins />
          <span>{kcoin?.available ?? (bootstrap.isLoading ? "…" : "—")}</span>
        </button>
        <button className="fgems">
          <i>◆</i>
          <span>{fgems?.available ?? (bootstrap.isLoading ? "…" : "—")}</span>
        </button>
        {Boolean(vip.data?.active) && (
          <button className="active" onClick={() => openDialog("vip")}>
            <Crown />
          </button>
        )}
        <button onClick={() => openDialog("wallet")}>
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
  );
}
