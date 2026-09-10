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
  useEffect(() => {
    void import("./DialogRenderer.tsx").then(
      (module) => setRenderer(() => module.DialogRenderer),
      () => setRenderer(false),
    );
  }, []);
  if (Renderer) return <Renderer {...props} />;
  const failed = Renderer === false;
  return (
    <div
      className="modal-backdrop app-shell app-modal-backdrop"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" role={failed ? "alert" : "status"}>
        <p>{failed ? t("画面暂时无法显示") : t("正在打开")}</p>
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
