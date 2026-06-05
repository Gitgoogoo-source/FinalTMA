import {
  Coins,
  RefreshCw,
  Star,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import { getPaymentStatusMeta, normalizePaymentStatus } from "../box.status";
import type {
  DrawResultItem,
  DrawResultResponse,
  PaymentSupportConfig,
} from "../box.types";
import { PaymentSupportLinks } from "./PaymentSupportLinks";

type DrawResultModalProps = {
  open: boolean;
  result: DrawResultResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  paymentSupport?: PaymentSupportConfig | null;
  onRetry: () => void;
  onClose: () => void;
};

export function DrawResultModal({
  open,
  result,
  isLoading,
  isError,
  errorMessage,
  paymentSupport = null,
  onRetry,
  onClose,
}: DrawResultModalProps) {
  if (!open) {
    return null;
  }

  const completed = result?.status === "completed";
  const pendingState = result ? getPendingResultState(result) : null;

  return (
    <div className="draw-result-modal" role="presentation">
      <button
        className="draw-result-modal__backdrop"
        aria-label="关闭开盒结果"
        onClick={onClose}
        type="button"
      />
      <section
        className="draw-result-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draw-result-title"
      >
        <header className="draw-result-modal__header">
          <div>
            <span>开盒结果</span>
            <h2 id="draw-result-title">{result?.boxName ?? "盲盒奖励"}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="draw-result-modal__body" aria-live="polite">
          {isLoading ? (
            <ResultState title="结果加载中" detail="正在读取服务端开盒结果。" />
          ) : null}
          {isError ? (
            <ResultState
              title="结果读取失败"
              detail={errorMessage ?? "开盒结果暂时无法读取，请稍后重试。"}
              onRetry={onRetry}
            />
          ) : null}
          {!isLoading && !isError && result && !completed ? (
            <ResultState
              title={pendingState?.title ?? "结果处理中"}
              detail={
                pendingState?.detail ?? "支付确认后，服务端会生成抽卡结果。"
              }
              paymentSupport={pendingState?.showSupport ? paymentSupport : null}
              onRetry={onRetry}
            />
          ) : null}
          {!isLoading && !isError && completed && result ? (
            <>
              <ResultSummary result={result} />
              <BalanceChanges result={result} />
              <div className="draw-result-list">
                {result.results.map((item) => (
                  <ResultItem
                    item={item}
                    key={`${item.drawIndex}-${item.itemInstanceId ?? item.name}`}
                  />
                ))}
              </div>
              <button
                className="draw-result-modal__confirm"
                onClick={onClose}
                type="button"
              >
                确认
              </button>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function getPendingResultState(result: DrawResultResponse): {
  title: string;
  detail: string;
  showSupport?: boolean;
} {
  const status = normalizePaymentStatus(
    result.paymentStatus ?? result.orderStatus,
  );

  if (status === "paid" || status === "paid_waiting_fulfillment") {
    return {
      title: "支付已成功，等待发货",
      detail: "Telegram 已确认支付，正在等待服务端发货事务。",
    };
  }

  if (status === "fulfilling") {
    return {
      title: "支付已成功，发货处理中",
      detail: "服务端正在生成抽卡结果、藏品和账本记录。",
    };
  }

  if (status === "failed" && result.paidAt) {
    return {
      title: "支付已成功，奖励补发中",
      detail: "发货事务异常，系统会重试补发；请不要重复支付。",
      showSupport: true,
    };
  }

  const statusMeta = getPaymentStatusMeta(
    result.paymentStatus ?? result.orderStatus,
  );

  return {
    title: statusMeta.title,
    detail: statusMeta.detail,
  };
}

function ResultSummary({ result }: { result: DrawResultResponse }) {
  const itemCount = result.results.length || result.quantity;
  const spend = getSpendSummary(result);
  const SpendIcon = spend.icon;

  return (
    <div className="draw-result-summary">
      <span>
        <Trophy aria-hidden="true" size={15} strokeWidth={2.4} />
        {formatCurrencyAmount(itemCount)} 件藏品
      </span>
      <span>
        <SpendIcon aria-hidden="true" size={15} strokeWidth={2.4} />
        {formatCurrencyAmount(spend.amount)} {spend.label}
      </span>
    </div>
  );
}

function BalanceChanges({ result }: { result: DrawResultResponse }) {
  const spend = getSpendSummary(result);
  const SpendIcon = spend.icon;

  return (
    <div className="draw-result-balance">
      <div className="draw-result-balance__heading">
        <strong>余额变化</strong>
        <span>
          {result.balances?.kcoin
            ? `当前 ${formatCurrencyAmount(result.balances.kcoin)} K-coin`
            : "资产栏已刷新"}
        </span>
      </div>
      <div className="draw-result-balance__grid" aria-label="余额变化">
        <span>
          <SpendIcon aria-hidden="true" size={15} strokeWidth={2.4} />
          {spend.label}
          <strong>-{formatCurrencyAmount(spend.amount)}</strong>
        </span>
      </div>
    </div>
  );
}

function getSpendSummary(result: DrawResultResponse): {
  amount: number;
  label: "K-coin" | "Stars";
  icon: LucideIcon;
} {
  if (result.paymentProvider === "kcoin" || result.paidKcoin > 0) {
    return {
      amount: result.paidKcoin,
      label: "K-coin",
      icon: Coins,
    };
  }

  return {
    amount: result.paidStars,
    label: "Stars",
    icon: Star,
  };
}

function ResultItem({ item }: { item: DrawResultItem }) {
  const imageUrl = item.imageUrl ?? item.thumbnailUrl;

  return (
    <article className="draw-result-item">
      <div className="draw-result-item__image">
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} />
        ) : (
          <span>{item.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="draw-result-item__copy">
        <strong>{item.name}</strong>
        <span>
          #{item.drawIndex}
          {" · 数量 1"}
          {item.rarityLabel ? ` · ${item.rarityLabel}` : ""}
          {item.formName ? ` · ${item.formName}` : ""}
        </span>
        {item.serialNumber ? <span>藏品编号 {item.serialNumber}</span> : null}
      </div>
      {item.isPityHit ? <em>保底</em> : null}
    </article>
  );
}

function ResultState({
  title,
  detail,
  paymentSupport = null,
  onRetry,
}: {
  title: string;
  detail: string;
  paymentSupport?: PaymentSupportConfig | null;
  onRetry?: () => void;
}) {
  return (
    <div className="draw-result-state">
      <strong>{title}</strong>
      <span>{detail}</span>
      <PaymentSupportLinks config={paymentSupport} />
      {onRetry ? (
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      ) : null}
    </div>
  );
}
