import { Coins, Crown, Gem, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  refreshTopAssetSummary,
  useApiQuery,
} from "../../platform/query/index.ts";

export type GlobalDialog = "topup" | "vip";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const [refreshState, setRefreshState] = useState<
    "idle" | "refreshing" | "failed"
  >("idle");
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
        <button
          type="button"
          className="icon-action asset-refresh"
          disabled={refreshState === "refreshing"}
          aria-busy={refreshState === "refreshing"}
          aria-label={
            refreshState === "refreshing"
              ? "顶部资产栏刷新中"
              : refreshState === "failed"
                ? "顶部资产栏刷新失败，重新刷新"
                : "刷新顶部资产栏"
          }
          onClick={() => {
            if (refreshState === "refreshing") return;
            setRefreshState("refreshing");
            void refreshTopAssetSummary()
              .then((success) => setRefreshState(success ? "idle" : "failed"))
              .catch(() => setRefreshState("failed"));
          }}
        >
          <RefreshCw
            className={refreshState === "refreshing" ? "spin" : undefined}
            aria-hidden="true"
          />
        </button>
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
