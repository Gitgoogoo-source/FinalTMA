import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../shared/ui/index.tsx";

export function MarketPurchaseSuccessDialog({
  name,
  quantity,
  onConfirm,
}: {
  name: string;
  quantity: number;
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal result-sheet-modal market-listing-success-modal market-purchase-success-modal">
      <div className="market-listing-result-copy">
        <h2 id="market-purchase-success-title">购买成功</h2>
        <p>
          已成功购买 {quantity} 个{name}
        </p>
      </div>
      <Button
        className="result-sheet-confirm market-listing-result-confirm"
        onClick={onConfirm}
      >
        完成
      </Button>
    </div>
  );
}

export function MarketPurchaseFailureDialog({
  message,
  onConfirm,
}: {
  message: string;
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal market-listing-failure-modal market-purchase-failure-modal">
      <div className="market-listing-result-mark is-failure" aria-hidden="true">
        <AlertCircle />
      </div>
      <div className="market-listing-result-copy">
        <h2 id="market-purchase-failure-title">购买未完成</h2>
        <p>{message}</p>
      </div>
      <Button onClick={onConfirm}>完成</Button>
    </div>
  );
}
