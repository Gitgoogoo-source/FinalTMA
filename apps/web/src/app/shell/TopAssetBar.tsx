import { lazy, Suspense, useState, type ReactNode } from "react";

import { VipDailyBenefits } from "../../domains/vip/ui/VipDailyBenefits.tsx";
import { formatNumber, getAppLanguage, tr } from "../../platform/i18n/index.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { getIdentityInitial } from "../../shared/identityInitial.ts";
import { preloadGlobalDialog } from "./global-dialog-loader.ts";

type AccountLanguageMenuModule = {
  default: (typeof import("./AccountLanguageMenu.tsx"))["AccountLanguageMenu"];
};

let accountLanguageMenuTask: Promise<AccountLanguageMenuModule> | null = null;
const loadAccountLanguageMenu = (): Promise<AccountLanguageMenuModule> => {
  accountLanguageMenuTask ??= import("./AccountLanguageMenu.tsx")
    .then((module) => ({ default: module.AccountLanguageMenu }))
    .catch((cause: unknown) => {
      accountLanguageMenuTask = null;
      throw cause;
    });
  return accountLanguageMenuTask;
};
const AccountLanguageMenu = lazy(loadAccountLanguageMenu);

export type GlobalDialog = "topup" | "vip";

export function TopAssetBar({
  openDialog,
}: {
  openDialog(dialog: GlobalDialog): void;
}): ReactNode {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
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
      <button
        type="button"
        className="identity account-menu-trigger"
        aria-label={tr("Open account and language menu", "打开账号与语言菜单")}
        aria-haspopup="dialog"
        onPointerDown={() =>
          void loadAccountLanguageMenu().catch(() => undefined)
        }
        onFocus={() => void loadAccountLanguageMenu().catch(() => undefined)}
        onClick={() => setAccountMenuOpen(true)}
      >
        <Avatar name={userLabel} />
        <div>
          <strong>{userLabel}</strong>
          <small>{user?.username ? `@${user.username}` : "PokePets"}</small>
        </div>
      </button>
      <VipDailyBenefits />
      <div className="asset-actions">
        <div
          className="asset-pill fgems"
          role="status"
          aria-live="polite"
          aria-label={`Fgems: ${fgems?.available ?? tr("Loading", "加载中")}`}
        >
          <img
            className="asset-icon"
            src="/assets/topbar/fgems-gem.png"
            width="20"
            height="20"
            alt=""
            aria-hidden="true"
          />
          <span className="asset-copy">
            <strong>{formatAsset(fgems?.available, summary.isLoading)}</strong>
          </span>
        </div>
        <button
          type="button"
          className="asset-pill kcoin"
          data-kcoin-target
          aria-label={`K-coin: ${kcoin?.available ?? tr("Loading", "加载中")}. ${tr("Open top-up", "打开充值")}`}
          onPointerDown={() => prepareGlobalDialog("topup")}
          onFocus={() => prepareGlobalDialog("topup")}
          onClick={() => openDialog("topup")}
        >
          <img
            className="asset-icon"
            src="/assets/topbar/kcoin-star.png"
            width="20"
            height="20"
            alt=""
            aria-hidden="true"
          />
          <span className="asset-copy">
            <strong>{formatAsset(kcoin?.available, summary.isLoading)}</strong>
          </span>
        </button>
      </div>
      {accountMenuOpen ? (
        <Suspense fallback={null}>
          <AccountLanguageMenu
            savedLanguage={user?.preferred_language ?? getAppLanguage()}
            close={() => setAccountMenuOpen(false)}
          />
        </Suspense>
      ) : null}
    </header>
  );
}

function prepareGlobalDialog(kind: GlobalDialog): void {
  void preloadGlobalDialog(kind).catch(() => undefined);
}

function formatAsset(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "…" : "—";
  return formatNumber(value);
}

function Avatar({ name }: { name: string }): ReactNode {
  return (
    <span className="avatar" aria-hidden="true">
      {getIdentityInitial(name)}
    </span>
  );
}
