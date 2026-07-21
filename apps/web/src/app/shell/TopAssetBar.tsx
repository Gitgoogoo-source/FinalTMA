import { Coins, Crown, Gem, RefreshCw, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../platform/query/index.ts";

export type GlobalDialog = "topup" | "vip" | "wallet";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const bootstrap = useApiQuery("identity.bootstrap");
  const vip = useApiQuery("vip.get");
  const wallet = useApiQuery("wallet.get");
  const kcoin = bootstrap.data?.assets.kcoin;
  const fgems = bootstrap.data?.assets.fgems;
  const user = bootstrap.data?.user;
  const displayName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");
  const userLabel = displayName || user?.username || "PokePets";
  const walletLabel = wallet.data?.verified_at
    ? shortWalletAddress(wallet.data.address ?? "")
    : wallet.data?.connected
      ? "验证中"
      : "TON";
  return (
    <header className="topbar">
      <div className="identity">
        <Avatar name={userLabel} photoUrl={user?.photo_url} />
        <div>
          <strong>{userLabel}</strong>
          <small>{user?.username ? `@${user.username}` : "PokePets"}</small>
        </div>
      </div>
      <div className="asset-actions">
        <button
          className={`wallet-action ${wallet.data?.verified_at ? "verified" : ""}`}
          disabled={Boolean(wallet.error)}
          aria-label={`TON 钱包：${walletLabel}`}
          onClick={() => openDialog("wallet")}
        >
          <WalletCards />
          <small>{walletLabel}</small>
        </button>
        <button
          className="asset-pill kcoin"
          aria-label={`K-coin：${kcoin?.available ?? "加载中"}，打开充值`}
          onClick={() => openDialog("topup")}
        >
          <Coins />
          <span>{formatAsset(kcoin?.available, bootstrap.isLoading)}</span>
        </button>
        <div
          className="asset-pill fgems"
          role="status"
          aria-live="polite"
          aria-label={`Fgems：${fgems?.available ?? "加载中"}`}
        >
          <Gem />
          <span>{formatAsset(fgems?.available, bootstrap.isLoading)}</span>
        </div>
        {vip.error ? (
          <button
            className="summary-retry"
            aria-label="VIP 状态加载失败，重新加载"
            onClick={() => void vip.refetch()}
          >
            VIP
          </button>
        ) : vip.data?.active ? (
          <button
            className="icon-action vip active"
            aria-label="查看有效 VIP 月卡"
            onClick={() => openDialog("vip")}
          >
            <Crown />
          </button>
        ) : null}
        {wallet.error ? (
          <button
            className="summary-retry"
            aria-label="钱包状态加载失败，重新加载"
            onClick={() => void wallet.refetch()}
          >
            TON
          </button>
        ) : null}
        <button
          className={`refresh ${bootstrap.isFetching || vip.isFetching || wallet.isFetching ? "is-refreshing" : ""}`}
          aria-label="刷新真实状态"
          disabled={bootstrap.isFetching || vip.isFetching || wallet.isFetching}
          onClick={() => {
            void bootstrap.refetch();
            void vip.refetch();
            void wallet.refetch();
          }}
        >
          <RefreshCw />
        </button>
      </div>
    </header>
  );
}

function formatAsset(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "…" : "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function shortWalletAddress(value: string): string {
  return value.length > 7
    ? `${value.slice(0, 3)}…${value.slice(-3)}`
    : value || "TON";
}

function Avatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null | undefined;
}): ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className="avatar">
      {photoUrl && failedUrl !== photoUrl ? (
        <img
          src={photoUrl}
          alt={`${name}头像`}
          onError={() => setFailedUrl(photoUrl)}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
