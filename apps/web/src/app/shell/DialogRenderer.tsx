import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { DialogRenderBoundary } from "./DialogRenderBoundary.tsx";

import { AppModal } from "../../shared/ui/AppModal.tsx";
import { Button } from "../../shared/ui/Button.tsx";
import type { TopupRequest } from "../../workflows/payment-recovery/context.ts";
import type { GlobalDialog } from "./TopAssetBar.tsx";
import {
  preloadGlobalDialog,
  reloadGlobalDialog,
  type LoadedGlobalDialog,
} from "./global-dialog-loader.ts";
import { t, tr } from "../../platform/i18n/index.ts";

export function DialogRenderer(
  props: ComponentProps<typeof DialogContent>,
): ReactNode {
  return (
    <DialogRenderBoundary key={props.active} close={props.close}>
      <DialogContent {...props} />
    </DialogRenderBoundary>
  );
}

function DialogContent({
  active,
  topupRequest,
  close,
}: {
  active: GlobalDialog | null;
  topupRequest: TopupRequest | null;
  close(): void;
}): ReactNode {
  const request = useRef(0);
  const [loaded, setLoaded] = useState<LoadedGlobalDialog | null>(null);
  const [failed, setFailed] = useState<GlobalDialog | null>(null);
  const load = useCallback((dialog: GlobalDialog) => {
    const current = ++request.current;
    void preloadGlobalDialog(dialog)
      .then((module) => {
        if (current !== request.current) return;
        setLoaded(module);
        setFailed(null);
      })
      .catch(() => {
        if (current !== request.current) return;
        setFailed(dialog);
      });
  }, []);
  useEffect(() => {
    if (active) load(active);
  }, [active, load]);
  if (!active) return null;
  if (failed === active)
    return <DialogPlaceholder kind={active} failed close={close} />;
  if (loaded?.kind === "account" && active === "account") {
    const AccountLanguageMenu = loaded.module.AccountLanguageMenu;
    return <AccountLanguageMenu close={close} />;
  }
  if (loaded?.kind === "wallet" && active === "wallet") {
    const WalletCapabilityDialog = loaded.module.WalletCapabilityDialog;
    return <WalletCapabilityDialog close={close} />;
  }
  if (loaded?.kind === "topup" && active === "topup") {
    const TopupDialog = loaded.module.TopupDialog;
    return <TopupDialog request={topupRequest} close={close} />;
  }
  if (loaded?.kind === "vip" && active === "vip") {
    const VipDialog = loaded.module.VipDialog;
    return <VipDialog close={close} />;
  }
  return <DialogPlaceholder kind={active} close={close} />;
}

export function DialogPlaceholder({
  kind,
  failed = false,
  close,
}: {
  kind: GlobalDialog;
  failed?: boolean;
  close(): void;
}): ReactNode {
  const title =
    kind === "topup"
      ? t("Stars 充值")
      : kind === "vip"
        ? tr("VIP Pass", "VIP 月卡")
        : kind === "wallet"
          ? tr("TON Wallet", "TON 钱包")
          : tr("Language", "语言");
  return (
    <AppModal
      className={
        kind === "topup"
          ? "topup-sheet-backdrop"
          : "dialog-placeholder-backdrop"
      }
      label={title}
      onClose={close}
    >
      <section
        className={`modal dialog-placeholder ${kind === "topup" ? "topup-sheet" : ""}`}
        aria-busy={!failed}
      >
        <h2>{title}</h2>
        {failed ? (
          <>
            <p role="alert">
              {tr(
                "This screen couldn't load. Please try again.",
                "画面暂时无法加载，请重试。",
              )}
            </p>
            <Button onClick={() => reloadGlobalDialog(kind)}>
              {t("重新加载画面")}
            </Button>
          </>
        ) : (
          <div
            className="dialog-skeleton"
            role="status"
            aria-label={t("加载中")}
          >
            <span />
            <span />
            <span />
          </div>
        )}
        <Button className="secondary" onClick={close}>
          {t("关闭")}
        </Button>
      </section>
    </AppModal>
  );
}
