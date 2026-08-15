import { Coins, Gem } from "lucide-react";
import type { ReactNode } from "react";

import { VipDailyBenefits } from "../../domains/vip/ui/VipDailyBenefits.tsx";
import { useApiQuery } from "../../platform/query/index.ts";
import { getIdentityInitial } from "../../shared/identityInitial.ts";
import { preloadGlobalDialog } from "./global-dialog-loader.ts";

export type GlobalDialog = "topup" | "vip";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const summary = useApiQuery("identity.summary");
  const kcoin = summary.data?.assets.kcoin;
  const fgems = summary.data?.assets.fgems;
  const user = summary.data?.user;
  const displayName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");
  const userLabel = displayName || user?.username || "PokePets";
  return (
    <header className="topbar">
      <div className="identity">
        <Avatar name={userLabel} />
        <div>
          <strong>{userLabel}</strong>
          <small>{user?.username ? `@${user.username}` : "PokePets"}</small>
        </div>
      </div>
      <VipDailyBenefits />
      <div className="asset-actions">
        <button
          type="button"
          className="asset-pill kcoin"
          data-kcoin-target
          aria-label={`K-coin：${kcoin?.available ?? "加载中"}，打开充值`}
          onPointerDown={() => prepareGlobalDialog("topup")}
          onFocus={() => prepareGlobalDialog("topup")}
          onClick={() => openDialog("topup")}
        >
          <Coins />
          <span className="asset-copy">
            <strong>{formatAsset(kcoin?.available, summary.isLoading)}</strong>
            <small>K-coin</small>
          </span>
        </button>
        <div
          className="asset-pill fgems"
          role="status"
          aria-live="polite"
          aria-label={`Fgems：${fgems?.available ?? "加载中"}`}
        >
          <Gem />
          <span className="asset-copy">
            <strong>{formatAsset(fgems?.available, summary.isLoading)}</strong>
            <small>Fgems</small>
          </span>
        </div>
      </div>
    </header>
  );
}

function prepareGlobalDialog(kind: GlobalDialog): void {
  void preloadGlobalDialog(kind).catch(() => undefined);
}

function formatAsset(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "…" : "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function Avatar({ name }: { name: string }): ReactNode {
  return (
    <span className="avatar" aria-hidden="true">
      {getIdentityInitial(name)}
    </span>
  );
}
