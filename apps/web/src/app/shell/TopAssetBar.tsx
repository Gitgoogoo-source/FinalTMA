import { Coins, Crown, RefreshCw, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  const wallet = useApiQuery("wallet.get");
  const kcoin = bootstrap.data?.assets.kcoin;
  const fgems = bootstrap.data?.assets.fgems;
  const user = bootstrap.data?.user;
  const displayName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");
  return (
    <header className="topbar">
      <div className="identity">
        <Avatar name={displayName || "PokePets"} photoUrl={user?.photo_url} />
        <div>
          <strong>{displayName || "—"}</strong>
          <small>
            {user?.username
              ? `@${user.username}`
              : (user?.id.slice(0, 8) ?? "—")}
          </small>
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
        {vip.error ? (
          <button className="summary-retry" onClick={() => void vip.refetch()}>
            VIP 重试
          </button>
        ) : (
          <button
            className={vip.data?.active ? "active" : ""}
            onClick={() => openDialog("vip")}
          >
            <Crown />
          </button>
        )}
        <button
          disabled={Boolean(wallet.error)}
          onClick={() => openDialog("wallet")}
        >
          <WalletCards />
        </button>
        {wallet.error ? (
          <button
            className="summary-retry"
            onClick={() => void wallet.refetch()}
          >
            钱包重试
          </button>
        ) : null}
        <Button
          className="refresh"
          aria-label="刷新真实状态"
          onClick={() => {
            void bootstrap.refetch();
            void vip.refetch();
            void wallet.refetch();
          }}
        >
          <RefreshCw />
        </Button>
      </div>
    </header>
  );
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
