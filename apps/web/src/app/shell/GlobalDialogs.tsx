import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "../../shared/ui/Button.tsx";
import { t } from "../../platform/i18n/index.ts";
import { reloadGlobalDialog } from "./global-dialog-loader.ts";
import type { DialogRenderer } from "./DialogRenderer.tsx";

type Renderer = typeof DialogRenderer;

export function GlobalDialogs(props: ComponentProps<Renderer>): ReactNode {
  return props.active ? <DialogLoader {...props} /> : null;
}

function DialogLoader(props: ComponentProps<Renderer>): ReactNode {
  const [Renderer, setRenderer] = useState<Renderer | false | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    void import("./DialogRenderer.tsx").then(
      (module) => setRenderer(() => module.DialogRenderer),
      () => setRenderer(false),
    );
  }, []);
  if (Renderer) return <Renderer {...props} />;
  const failed = Renderer === false;
  if (!failed && !waiting) return null;
  return (
    <div
      className={`modal-backdrop app-shell app-modal-backdrop${props.active === "topup" ? " topup-loading-backdrop" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" role={failed ? "alert" : "status"}>
        {failed ? (
          <p>{t("画面暂时无法显示")}</p>
        ) : (
          <div className="shell-dialog-skeleton" aria-label={t("加载中")}>
            <span />
            <span />
            <span />
          </div>
        )}
        {failed ? (
          <Button
            type="button"
            onClick={() => reloadGlobalDialog(props.active!)}
          >
            {t("重新加载画面")}
          </Button>
        ) : null}
        <Button type="button" className="secondary" onClick={props.close}>
          {t("稍后再看")}
        </Button>
      </div>
    </div>
  );
}
