import { ReceiptText } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import { calculateMarketFeePreview, formatKcoinWithUnit } from "../trade.utils";

type SellFeePreviewProps = {
  feeBps: number | null;
  isFeeRulesError?: boolean;
  isFeeRulesLoading?: boolean;
  item: SellableItemGroup | null;
  quantity: number;
  unitPriceKcoin: number | null;
};

export function SellFeePreview({
  feeBps,
  isFeeRulesError = false,
  isFeeRulesLoading = false,
  item,
  quantity,
  unitPriceKcoin,
}: SellFeePreviewProps) {
  const grossAmountKcoin =
    unitPriceKcoin && item ? unitPriceKcoin * quantity : null;
  const preview =
    grossAmountKcoin !== null && feeBps !== null
      ? calculateMarketFeePreview(unitPriceKcoin ?? 0, quantity, feeBps)
      : null;
  const feeLabel =
    feeBps === null
      ? isFeeRulesLoading
        ? "读取中"
        : "最终以后端为准"
      : `${formatFeeBps(feeBps)} 平台手续费`;

  return (
    <section className="sell-fee-preview" aria-label="手续费预览">
      <div className="sell-fee-preview__heading">
        <ReceiptText aria-hidden="true" size={18} strokeWidth={2.4} />
        <div>
          <span>手续费预览</span>
          <strong>{feeLabel}</strong>
        </div>
      </div>

      <dl className="sell-fee-preview__metrics">
        <div>
          <dt>单价</dt>
          <dd>
            {unitPriceKcoin ? formatKcoinWithUnit(unitPriceKcoin) : "未设置"}
          </dd>
        </div>
        <div>
          <dt>数量</dt>
          <dd>{item ? quantity : "-"}</dd>
        </div>
        <div>
          <dt>总价</dt>
          <dd>
            {grossAmountKcoin === null
              ? "-"
              : formatKcoinWithUnit(grossAmountKcoin)}
          </dd>
        </div>
        <div>
          <dt>平台手续费</dt>
          <dd>
            {preview
              ? formatKcoinWithUnit(preview.feeAmountKcoin)
              : getUnavailableFeeLabel(isFeeRulesLoading, isFeeRulesError)}
          </dd>
        </div>
        <div>
          <dt>预计到手</dt>
          <dd>
            {preview
              ? formatKcoinWithUnit(preview.netAmountKcoin)
              : getUnavailableFeeLabel(isFeeRulesLoading, isFeeRulesError)}
          </dd>
        </div>
        <div>
          <dt>建议价格区间</dt>
          <dd>{item ? formatSuggestedRange(item) : "未选择"}</dd>
        </div>
      </dl>
    </section>
  );
}

function getUnavailableFeeLabel(isLoading: boolean, isError: boolean): string {
  if (isLoading) {
    return "读取中";
  }

  if (isError) {
    return "暂无参考";
  }

  return "-";
}

function formatFeeBps(feeBps: number): string {
  if (!Number.isFinite(feeBps)) {
    return "0%";
  }

  return `${(Math.max(Math.trunc(feeBps), 0) / 100)
    .toFixed(2)
    .replace(/\.00$/, "")}%`;
}

function formatSuggestedRange(item: SellableItemGroup): string {
  if (item.minPriceKcoin !== null && item.maxPriceKcoin !== null) {
    return `${formatKcoinWithUnit(item.minPriceKcoin)} - ${formatKcoinWithUnit(
      item.maxPriceKcoin,
    )}`;
  }

  if (item.suggestedPriceKcoin !== null) {
    return formatKcoinWithUnit(item.suggestedPriceKcoin);
  }

  if (item.minPriceKcoin !== null) {
    return `不低于 ${formatKcoinWithUnit(item.minPriceKcoin)}`;
  }

  if (item.maxPriceKcoin !== null) {
    return `不高于 ${formatKcoinWithUnit(item.maxPriceKcoin)}`;
  }

  return "暂无参考";
}
