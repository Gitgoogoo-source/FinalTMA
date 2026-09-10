import type { ReactNode } from "react";

import { VipDailyBenefits } from "../../domains/vip/ui/VipDailyBenefits.tsx";
import { getAppLanguage, tr } from "../../platform/i18n/index.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { getIdentityInitial } from "../../shared/identityInitial.ts";
import { preloadGlobalDialog } from "./global-dialog-loader.ts";

export type GlobalDialog = "topup" | "vip" | "wallet" | "account";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const summary = useApiQuery("identity.summary");
  const wallet = useApiQuery("wallet.get");
  const walletConnected = wallet.data?.connected === true;
  const walletLabel = `${tr("Open TON wallet", "打开 TON 钱包")} · ${
    walletConnected ? tr("Connected", "已连接") : tr("Not connected", "未连接")
  }`;
  const kcoin = summary.data?.assets.kcoin;
  const fgems = summary.data?.assets.fgems;
  const user = summary.data?.user;
  const displayName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");
  const userLabel = displayName || user?.username || "EvoMyPet";
  return (
    <header className="topbar">
      <button
        type="button"
        className="identity account-menu-trigger"
        aria-label={tr("Open account and language menu", "打开账号与语言菜单")}
        aria-haspopup="dialog"
        {...dialogTrigger("account", openDialog)}
      >
        <Avatar name={userLabel} />
        <div>
          <strong>{userLabel}</strong>
          <small>{user?.username ? `@${user.username}` : "EvoMyPet"}</small>
        </div>
      </button>
      <VipDailyBenefits />
      <div className="asset-actions">
        <button
          type="button"
          className="ton-wallet-action"
          data-connected={walletConnected}
          aria-label={walletLabel}
          title={walletLabel}
          aria-haspopup="dialog"
          {...dialogTrigger("wallet", openDialog)}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6.5 4A3.5 3.5 0 0 0 3 7.5v9A3.5 3.5 0 0 0 6.5 20H18a3 3 0 0 0 3-3v-.5h-4a4.5 4.5 0 0 1 0-9H6.5a.75.75 0 0 1 0-1.5H20a2 2 0 0 0-2-2H6.5Z"
              fill="currentColor"
            />
            <path
              d="M17 9a3 3 0 0 0 0 6h4.5V9H17Zm.25 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </button>
        <div
          className="asset-pill fgems"
          role="status"
          aria-live="polite"
          aria-label={`Gems: ${fgems?.available ?? tr("Loading", "加载中")}`}
        >
          <AssetAmount
            image="fgems-gem"
            value={fgems?.available}
            loading={summary.isLoading}
          />
        </div>
        <button
          type="button"
          className="asset-pill kcoin"
          data-kcoin-target
          aria-label={`Stars: ${kcoin?.available ?? tr("Loading", "加载中")}. ${tr("Open top-up", "打开充值")}`}
          {...dialogTrigger("topup", openDialog)}
        >
          <AssetAmount
            image="kcoin-star"
            value={kcoin?.available}
            loading={summary.isLoading}
          />
        </button>
      </div>
    </header>
  );
}

function dialogTrigger(kind: GlobalDialog, open: (kind: GlobalDialog) => void) {
  const prepare = () => {
    void preloadGlobalDialog(kind).catch(() => undefined);
  };
  return {
    onPointerDown: prepare,
    onFocus: prepare,
    onClick: () => open(kind),
  };
}

function formatAsset(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "…" : "—";
  return value < 10_000
    ? String(value)
    : new Intl.NumberFormat(getAppLanguage(), {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
}

function AssetAmount({
  image,
  value,
  loading,
}: {
  image: string;
  value: number | undefined;
  loading: boolean;
}): ReactNode {
  return (
    <>
      <img
        className="asset-icon"
        src={`/assets/topbar/${image}.png`}
        width="20"
        height="20"
        alt=""
        aria-hidden="true"
      />
      <span className="asset-copy">
        <strong>{formatAsset(value, loading)}</strong>
      </span>
    </>
  );
}

function Avatar({ name }: { name: string }): ReactNode {
  return (
    <span className="avatar" aria-hidden="true">
      {getIdentityInitial(name)}
    </span>
  );
}
