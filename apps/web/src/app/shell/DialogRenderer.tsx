import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { DialogRenderBoundary } from "./DialogRenderBoundary.tsx";

import { Button } from "../../shared/ui/Button.tsx";
import type { TopupRequest } from "../../workflows/payment-recovery/context.ts";
import type { GlobalDialog } from "./TopAssetBar.tsx";
import {
  preloadGlobalDialog,
  reloadGlobalDialog,
  type LoadedGlobalDialog,
} from "./global-dialog-loader.ts";
import { t } from "../../platform/i18n/index.ts";

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
    return (
      <div
        className="modal-backdrop app-shell app-modal-backdrop"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal" role="alert">
          <h2>{t("画面暂时无法显示")}</h2>
          <p>{t("状态已保留，重新加载画面不会重复执行操作。")}</p>
          <Button onClick={() => reloadGlobalDialog(active)}>
            {t("重新加载画面")}
          </Button>
          <Button className="secondary" onClick={close}>
            {t("稍后再看")}
          </Button>
        </div>
      </div>
    );
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
  return (
    <div
      className="modal-backdrop app-shell app-modal-backdrop"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" role="status">
        <h2>{t("正在打开")}</h2>
        <p>{t("精彩内容马上呈现。")}</p>
      </div>
    </div>
  );
}
