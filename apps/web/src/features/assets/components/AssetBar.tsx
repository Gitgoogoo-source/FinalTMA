import { RefreshCw } from "lucide-react";

import { useMyAssets } from "../hooks/useMyAssets";
import { FgemsPill } from "./FgemsPill";
import { KCoinPill } from "./KCoinPill";
import { useKcoinTopupSheet } from "./KcoinTopupProvider";
import { UserAvatar } from "./UserAvatar";
import { WalletEntryButton } from "./WalletEntryButton";

export function AssetBar() {
  const { assets, data, isError, isFetching, profile, refreshAssets } =
    useMyAssets();
  const { openKcoinTopupSheet } = useKcoinTopupSheet();
  const showLoadingAmount = isFetching && data.updatedAt === null;
  const showUnavailableAmount =
    isError && !isFetching && data.updatedAt === null;

  return (
    <header className="asset-bar" aria-busy={isFetching}>
      <div className="asset-bar__identity">
        <UserAvatar profile={profile} />
        <div className="asset-bar__actions">
          {isError ? (
            <button
              className="asset-bar__refresh"
              onClick={() => void refreshAssets()}
              title="刷新资产"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
              <span>刷新</span>
            </button>
          ) : null}
          <WalletEntryButton />
        </div>
      </div>
      <div className="asset-bar__balances" aria-label="用户资产">
        <KCoinPill
          balance={assets.kcoin}
          isLoading={showLoadingAmount}
          isUnavailable={showUnavailableAmount}
          onClick={() => openKcoinTopupSheet()}
        />
        <FgemsPill
          balance={assets.fgems}
          isLoading={showLoadingAmount}
          isUnavailable={showUnavailableAmount}
        />
      </div>
    </header>
  );
}
