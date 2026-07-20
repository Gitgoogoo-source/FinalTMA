import { Dna, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import {
  evolutionRejectedResultSchema,
  routeById,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import { Badge, Button, CatalogImage } from "../../shared/ui/index.tsx";
import type { OperationPhase } from "./context.ts";

type EvolutionResult = RouteOutput<"inventory.evolve">;
type Rarity = EvolutionResult["target"]["rarity"];
type SuccessAction = "inventory" | "album";

const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const rejectedMessages: Record<string, string> = {
  EVOLUTION_NOT_AVAILABLE: "数据已更新，请重新确认",
  INSUFFICIENT_INVENTORY: "可用数量已变化，请重新确认",
  INSUFFICIENT_BALANCE: "Fgems 不足，无法进化",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
};

export function EvolutionOperationDialog({
  operationId,
  phase,
  message,
  result,
  errorCode,
  busy,
  actionError,
  onRecover,
  onSuccess,
  onAcknowledge,
}: {
  operationId: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
  busy: boolean;
  actionError: string | null;
  onRecover(): void;
  onSuccess(action: SuccessAction): void;
  onAcknowledge(): void;
}): ReactNode {
  const parsed = routeById("inventory.evolve").output.safeParse(result);
  if (phase === "succeeded" && parsed.success)
    return parsed.data.success ? (
      <EvolutionSuccess
        operationId={operationId}
        result={parsed.data}
        busy={busy}
        actionError={actionError}
        onSuccess={onSuccess}
      />
    ) : (
      <EvolutionFailure
        operationId={operationId}
        result={parsed.data}
        busy={busy}
        actionError={actionError}
        onAcknowledge={onAcknowledge}
      />
    );

  if (phase === "failed") {
    const rejected = evolutionRejectedResultSchema.safeParse(result);
    const code = rejected.success ? rejected.data.error_code : errorCode;
    return (
      <div className="modal evolution-result-modal">
        <span className="operation-mark failed" aria-hidden="true">
          !
        </span>
        <h2 id="evolution-result-title">进化未执行</h2>
        <p>{rejectedMessages[code ?? ""] ?? "系统繁忙，请稍后重试"}</p>
        <code>操作号 {operationId}</code>
        {actionError ? (
          <p className="operation-ack-error">{actionError}</p>
        ) : null}
        <Button disabled={busy} onClick={onAcknowledge}>
          {busy ? "正在刷新数据" : "刷新数据"}
        </Button>
      </div>
    );
  }

  const invalidResult = phase === "succeeded";
  return (
    <div className="modal evolution-process-modal">
      <span className="evolution-process-mark" aria-hidden="true">
        <Dna />
      </span>
      <h2 id="evolution-result-title">正在确认进化结果</h2>
      <p>
        {invalidResult
          ? "进化结果详情暂时无法确认，请查询原操作"
          : phase === "unknown"
            ? "网络异常，正在确认进化结果"
            : message}
      </p>
      <div className="evolution-process-track" aria-hidden="true">
        <i />
      </div>
      <code>操作号 {operationId}</code>
      {(phase === "pending" || phase === "unknown" || invalidResult) && (
        <Button onClick={onRecover}>查询原操作</Button>
      )}
    </div>
  );
}

function EvolutionSuccess({
  operationId,
  result,
  busy,
  actionError,
  onSuccess,
}: {
  operationId: string;
  result: EvolutionResult;
  busy: boolean;
  actionError: string | null;
  onSuccess(action: SuccessAction): void;
}): ReactNode {
  return (
    <div className="modal evolution-result-modal">
      <header className="evolution-result-heading">
        <span aria-hidden="true">
          <Sparkles />
        </span>
        <div>
          <small>进化成功</small>
          <h2 id="evolution-result-title">{result.target.name}</h2>
        </div>
      </header>
      <div className="evolution-success-target">
        <div>
          <CatalogImage
            path={result.target.image_detail_path}
            alt={result.target.name}
            variant="detail"
            loading="eager"
            fetchPriority="high"
          />
          <b className="new-indicator">NEW</b>
        </div>
        <p>
          <Badge>
            {rarityLabels[result.target.rarity]} · 第 {result.target.stage} 阶
          </Badge>
          <strong>获得 ×{result.target_awarded}</strong>
          <span>{result.new_album ? "首次点亮图鉴" : "图鉴已点亮"}</span>
        </p>
      </div>
      <dl className="result-summary">
        <div>
          <dt>实际扣除材料</dt>
          <dd>
            {result.source.name} ×{result.materials.consumed}
          </dd>
        </div>
        <div>
          <dt>实际扣除 Fgems</dt>
          <dd>{result.fgems_spent}</dd>
        </div>
        <div>
          <dt>本次成功率</dt>
          <dd>
            {result.success_rate_percent}%
            {result.pity.guaranteed_this_attempt ? " · 已触发保底" : ""}
          </dd>
        </div>
        <div>
          <dt>路线保底</dt>
          <dd>已清空</dd>
        </div>
      </dl>
      <code>操作号 {operationId}</code>
      {actionError ? (
        <p className="operation-ack-error">{actionError}</p>
      ) : null}
      <div className="button-row">
        <Button disabled={busy} onClick={() => onSuccess("inventory")}>
          {busy ? "正在确认结果" : "查看藏品"}
        </Button>
        <Button
          className="secondary"
          disabled={busy}
          onClick={() => onSuccess("album")}
        >
          查看图鉴
        </Button>
      </div>
    </div>
  );
}

function EvolutionFailure({
  operationId,
  result,
  busy,
  actionError,
  onAcknowledge,
}: {
  operationId: string;
  result: EvolutionResult;
  busy: boolean;
  actionError: string | null;
  onAcknowledge(): void;
}): ReactNode {
  return (
    <div className="modal evolution-result-modal">
      <span className="operation-mark failed" aria-hidden="true">
        !
      </span>
      <h2 id="evolution-result-title">进化失败</h2>
      <p>本次没有获得 {result.target.name}，路线保底已经推进。</p>
      <dl className="result-summary">
        <div>
          <dt>实际扣除材料</dt>
          <dd>
            {result.source.name} ×{result.materials.consumed}
          </dd>
        </div>
        <div>
          <dt>保留材料</dt>
          <dd>×{result.materials.retained}</dd>
        </div>
        <div>
          <dt>实际扣除 Fgems</dt>
          <dd>{result.fgems_spent}</dd>
        </div>
        <div>
          <dt>最新保底进度</dt>
          <dd>
            连续失败 {result.pity.current_failure_count} 次 · 第{" "}
            {result.pity.guarantee_attempt} 次必成
          </dd>
        </div>
        <div>
          <dt>距离必成</dt>
          <dd>{resultPityDistance(result)}</dd>
        </div>
      </dl>
      <code>操作号 {operationId}</code>
      {actionError ? (
        <p className="operation-ack-error">{actionError}</p>
      ) : null}
      <Button disabled={busy} onClick={onAcknowledge}>
        {busy ? "正在确认结果" : "知道了"}
      </Button>
    </div>
  );
}

function resultPityDistance(result: EvolutionResult): string {
  const remaining = result.pity.failures_until_guaranteed;
  return remaining === 0
    ? "下次进化必定成功"
    : `再失败 ${remaining} 次后，下次进化必定成功`;
}
