import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../shared/ui/Button.tsx";
import { t } from "../../platform/i18n/index.ts";

export function MarketListingSuccessDialog({
  onConfirm,
}: {
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal result-sheet-modal market-listing-success-modal">
      <div className="market-listing-result-mark is-success" aria-hidden="true">
        <CheckCircle2 />
      </div>
      <div className="market-listing-result-copy">
        <span>{t("交易市场")}</span>
        <h2 id="market-listing-success-title">{t("上架成功")}</h2>
        <p>{t("藏品已成功上架，可在管理页查看当前出售状态。")}</p>
      </div>
      <Button
        className="result-sheet-confirm market-listing-result-confirm"
        onClick={onConfirm}
      >
        {t("确定")}
      </Button>
    </div>
  );
}

export function MarketListingFailureDialog({
  message,
  onConfirm,
}: {
  message: string;
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal market-listing-failure-modal">
      <div className="market-listing-result-mark is-failure" aria-hidden="true">
        <AlertCircle />
      </div>
      <div className="market-listing-result-copy">
        <h2 id="market-listing-failure-title">{t("上架未完成")}</h2>
        <p>{message}</p>
      </div>
      <Button onClick={onConfirm}>{t("确定")}</Button>
    </div>
  );
}
