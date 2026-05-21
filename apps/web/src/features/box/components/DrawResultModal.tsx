import { RefreshCw, Star, Trophy, X } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { DrawResultItem, DrawResultResponse } from "../box.types";

type DrawResultModalProps = {
  open: boolean;
  result: DrawResultResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onClose: () => void;
};

export function DrawResultModal({
  open,
  result,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onClose,
}: DrawResultModalProps) {
  if (!open) {
    return null;
  }

  const completed = result?.status === "completed";

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
              title="结果处理中"
              detail="支付确认后，服务端会生成抽卡结果。"
              onRetry={onRetry}
            />
          ) : null}
          {!isLoading && !isError && completed && result ? (
            <>
              <ResultSummary result={result} />
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

function ResultSummary({ result }: { result: DrawResultResponse }) {
  return (
    <div className="draw-result-summary">
      <span>
        <Trophy aria-hidden="true" size={15} strokeWidth={2.4} />
        {result.quantity} 次开盒
      </span>
      <span>
        <Star aria-hidden="true" size={15} strokeWidth={2.4} />
        {formatCurrencyAmount(result.paidStars)} Stars
      </span>
      <span>返还 {formatCurrencyAmount(result.returnedKcoin)} K-coin</span>
    </div>
  );
}

function ResultItem({ item }: { item: DrawResultItem }) {
  return (
    <article className="draw-result-item">
      <div className="draw-result-item__image">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} />
        ) : (
          <span>{item.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="draw-result-item__copy">
        <strong>{item.name}</strong>
        <span>
          #{item.drawIndex}
          {item.rarityLabel ? ` · ${item.rarityLabel}` : ""}
          {item.formName ? ` · ${item.formName}` : ""}
        </span>
      </div>
      {item.isPityHit ? <em>保底</em> : null}
    </article>
  );
}

function ResultState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div className="draw-result-state">
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry ? (
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      ) : null}
    </div>
  );
}
