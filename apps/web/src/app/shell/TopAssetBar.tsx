import { Coins, Crown, Gem } from "lucide-react";
import { useState, type ReactNode } from "react";

import { VipDailyBenefits } from "../../domains/vip/index.ts";
import { useApiQuery } from "../../platform/query/index.ts";

export type GlobalDialog = "topup" | "vip";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const bootstrap = useApiQuery("identity.bootstrap");
  const vip = useApiQuery("vip.get");
  const kcoin = bootstrap.data?.assets.kcoin;
  const fgems = bootstrap.data?.assets.fgems;
  const user = bootstrap.data?.user;
  const displayName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");
  const userLabel = displayName || user?.username || "PokePets";
  return (
    <header className="topbar">
      <div className="identity">
        <Avatar name={userLabel} photoUrl={user?.photo_url} />
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
          aria-label={`K-coin：${kcoin?.available ?? "加载中"}，打开充值`}
          onClick={() => openDialog("topup")}
        >
          <Coins />
          <span className="asset-copy">
            <strong>
              {formatAsset(kcoin?.available, bootstrap.isLoading)}
            </strong>
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
            <strong>
              {formatAsset(fgems?.available, bootstrap.isLoading)}
            </strong>
            <small>Fgems</small>
          </span>
        </div>
        {vip.error ? (
          <button
            type="button"
            className="summary-retry"
            aria-label="VIP 状态加载失败，重新加载"
            onClick={() => void vip.refetch()}
          >
            VIP
          </button>
        ) : vip.data?.active ? (
          <button
            type="button"
            className="icon-action vip active"
            aria-label="查看有效 VIP 月卡"
            onClick={() => openDialog("vip")}
          >
            <Crown />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function formatAsset(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "…" : "—";
  return new Intl.NumberFormat("zh-CN").format(value);
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
