import { Component, type ReactNode } from "react";
import { AppModal } from "../../shared/ui/AppModal.tsx";
import { Button } from "../../shared/ui/Button.tsx";
import { t } from "../../platform/i18n/index.ts";

export class DialogRenderBoundary extends Component<
  {
    children: ReactNode;
    close(): void;
  },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <AppModal label={t("画面暂时无法显示")} onClose={this.props.close}>
        <div className="modal" role="alert">
          <p>{t("画面暂时无法显示")}</p>
          <Button onClick={() => this.setState({ failed: false })}>
            {t("重新加载画面")}
          </Button>
          <Button className="secondary" onClick={this.props.close}>
            {t("稍后再看")}
          </Button>
        </div>
      </AppModal>
    );
  }
}
