import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  evolutionRejectedResultSchema,
  routeById,
  type RouteOutput,
} from "@pokepets/api-contracts/app";
import { X } from "lucide-react";

import { evolutionRoute } from "../../domains/evolution/config.ts";
import { haptic, selectionHaptic } from "../../platform/telegram/index.ts";
import { Badge, Button, CatalogImage } from "../../shared/ui/index.tsx";
import type { OperationPhase } from "./context.ts";

type EvolutionResult = RouteOutput<"inventory.evolve">;
type Rarity = EvolutionResult["target"]["rarity"];
type SuccessAction = "inventory" | "album";

type EvolutionPresentation = {
  sourceName: string;
  sourceImagePath: string | null;
  targetImagePath: string | null;
};

const CEREMONY_DURATION_MS = 5_000;
const STAGE_BACKGROUND = "/assets/evolution/eclipse-stage.webp";
const CONFETTI = "/assets/evolution/confetti.webp";
const FAILURE_MOTES = "/assets/evolution/failure-motes.webp";

const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const rejectedMessages: Record<string, string> = {
  EVOLUTION_NOT_AVAILABLE: "藏品状态已经变化，请重新选择",
  INSUFFICIENT_INVENTORY: "可用数量已经变化，请重新选择",
  INSUFFICIENT_BALANCE: "Fgems 不足，无法进化",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
};

export function EvolutionOperationDialog({
  operationId,
  phase,
  input,
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
  input: unknown;
  result: unknown;
  errorCode: string | null;
  busy: boolean;
  actionError: string | null;
  onRecover(): void;
  onSuccess(action: SuccessAction): void;
  onAcknowledge(): void;
}): ReactNode {
  const parsed = routeById("inventory.evolve").output.safeParse(result);
  const confirmedResult = parsed.success ? parsed.data : null;
  const presentation = useMemo(
    () => evolutionPresentation(input, confirmedResult),
    [confirmedResult, input],
  );
  const [ceremonyComplete, setCeremonyComplete] = useState(false);
  const announcedOutcome = useRef<string | null>(null);

  useEffect(() => {
    const pulseTimers = [1_600, 2_850, 3_750, 4_350, 4_720].map((delay) =>
      window.setTimeout(selectionHaptic, delay),
    );
    const timer = window.setTimeout(
      () => setCeremonyComplete(true),
      CEREMONY_DURATION_MS,
    );
    return () => {
      pulseTimers.forEach((pulseTimer) => window.clearTimeout(pulseTimer));
      window.clearTimeout(timer);
    };
  }, [operationId]);

  useEffect(() => {
    if (!ceremonyComplete) return;
    const outcome =
      phase === "succeeded" && confirmedResult
        ? confirmedResult.success_count > 0
          ? "success"
          : "failure"
        : phase === "failed"
          ? "rejected"
          : "interrupted";
    if (announcedOutcome.current === outcome) return;
    announcedOutcome.current = outcome;
    haptic(
      outcome === "success"
        ? "success"
        : outcome === "rejected"
          ? "error"
          : "warning",
    );
  }, [ceremonyComplete, confirmedResult, phase]);

  if (!ceremonyComplete)
    return <EvolutionCeremony presentation={presentation} />;

  if (phase === "succeeded" && confirmedResult)
    return confirmedResult.success_count > 0 ? (
      <EvolutionSuccess
        result={confirmedResult}
        busy={busy}
        actionError={actionError}
        onSuccess={onSuccess}
      />
    ) : (
      <EvolutionFailure
        result={confirmedResult}
        busy={busy}
        actionError={actionError}
        onAcknowledge={onAcknowledge}
      />
    );

  if (phase === "failed") {
    const rejected = evolutionRejectedResultSchema.safeParse(result);
    const code = rejected.success ? rejected.data.error_code : errorCode;
    return (
      <EvolutionStage className="evolution-stage--rejected">
        <EvolutionPet
          path={presentation.sourceImagePath}
          alt={presentation.sourceName}
          className="evolution-stage-pet--restored"
        />
        <section className="evolution-result-panel evolution-result-panel--dismissible">
          <EvolutionResultClose disabled={busy} onClick={onAcknowledge} />
          <p className="evolution-result-kicker">本次没有产生结算</p>
          <h2 id="evolution-result-title">进化未执行</h2>
          <p>
            {rejectedMessages[code ?? ""] ?? "进化仪式暂时无法开始，请稍后重试"}
          </p>
          {actionError ? (
            <p className="operation-ack-error">{actionError}</p>
          ) : null}
          <Button disabled={busy} onClick={onAcknowledge}>
            {busy ? "正在返回" : "返回藏品页"}
          </Button>
        </section>
      </EvolutionStage>
    );
  }

  return (
    <EvolutionStage className="evolution-stage--interrupted">
      <EvolutionPet
        path={presentation.sourceImagePath}
        alt={presentation.sourceName}
        className="evolution-stage-pet--restored"
      />
      <section className="evolution-result-panel">
        <p className="evolution-result-kicker">藏品保持原形态</p>
        <h2 id="evolution-result-title">进化中断</h2>
        <p>进化仪式被打断，请重新确认结果</p>
        <Button onClick={onRecover}>重新确认</Button>
      </section>
    </EvolutionStage>
  );
}

function EvolutionCeremony({
  presentation,
}: {
  presentation: EvolutionPresentation;
}): ReactNode {
  return (
    <EvolutionStage className="evolution-ceremony-stage">
      <h2 id="evolution-result-title" className="evolution-ceremony-sr-title">
        进化仪式
      </h2>
      <p className="evolution-ceremony-copy" aria-hidden="true">
        进化
      </p>
      <EvolutionPet
        path={presentation.targetImagePath}
        alt=""
        className="evolution-ceremony-shadow"
      />
      <img
        className="evolution-ceremony-flash"
        src={STAGE_BACKGROUND}
        alt=""
        aria-hidden="true"
      />
    </EvolutionStage>
  );
}

function EvolutionSuccess({
  result,
  busy,
  actionError,
  onSuccess,
}: {
  result: EvolutionResult;
  busy: boolean;
  actionError: string | null;
  onSuccess(action: SuccessAction): void;
}): ReactNode {
  return (
    <EvolutionStage className="evolution-stage--success" celebration>
      <EvolutionPet
        path={result.target.image_detail_path}
        alt={result.target.name}
        className="evolution-stage-pet--revealed"
      />
      <h2 id="evolution-result-title" className="evolution-stage-callout">
        进化成功
      </h2>
      <section className="evolution-result-panel evolution-result-panel--dismissible evolution-success-panel">
        <EvolutionResultClose
          disabled={busy}
          onClick={() => onSuccess("inventory")}
        />
        <header>
          <p className="evolution-result-kicker">进化成功</p>
          <h3>{result.target.name}</h3>
          <Badge>
            {rarityLabels[result.target.rarity]} · 第 {result.target.stage} 阶
          </Badge>
        </header>
        <div className="evolution-result-award">
          <b className="new-indicator">NEW</b>
          <strong>获得 ×{result.target_awarded}</strong>
          <span>{result.new_album ? "首次点亮图鉴" : "图鉴已点亮"}</span>
        </div>
        <SettlementDetails result={result} success />
        {actionError ? (
          <p className="operation-ack-error">{actionError}</p>
        ) : null}
        <div className="button-row">
          <Button disabled={busy} onClick={() => onSuccess("inventory")}>
            {busy ? "正在整理奖励" : "查看藏品"}
          </Button>
          <Button
            className="secondary"
            disabled={busy}
            onClick={() => onSuccess("album")}
          >
            查看图鉴
          </Button>
        </div>
      </section>
    </EvolutionStage>
  );
}

function EvolutionFailure({
  result,
  busy,
  actionError,
  onAcknowledge,
}: {
  result: EvolutionResult;
  busy: boolean;
  actionError: string | null;
  onAcknowledge(): void;
}): ReactNode {
  return (
    <EvolutionStage className="evolution-stage--failure" failure>
      <EvolutionPet
        path={result.source.image_detail_path}
        alt={result.source.name}
        className="evolution-stage-pet--restored"
      />
      <section className="evolution-result-panel evolution-result-panel--dismissible evolution-failure-panel">
        <EvolutionResultClose disabled={busy} onClick={onAcknowledge} />
        <p className="evolution-result-kicker">藏品保持原形态</p>
        <h2 id="evolution-result-title">进化失败</h2>
        <p>
          {result.source.name} 从暗色光点中恢复，本次没有获得{" "}
          {result.target.name}。
        </p>
        <SettlementDetails result={result} />
        {actionError ? (
          <p className="operation-ack-error">{actionError}</p>
        ) : null}
        <Button disabled={busy} onClick={onAcknowledge}>
          {busy ? "正在整理结果" : "知道了"}
        </Button>
      </section>
    </EvolutionStage>
  );
}

function EvolutionResultClose({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className="evolution-result-close"
      aria-label="关闭进化结果并返回藏品页"
      disabled={disabled}
      onClick={onClick}
    >
      <X aria-hidden="true" />
    </button>
  );
}

function EvolutionStage({
  className,
  celebration = false,
  failure = false,
  children,
}: {
  className: string;
  celebration?: boolean;
  failure?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`evolution-stage ${className}`}>
      <img
        className="evolution-stage-background"
        src={STAGE_BACKGROUND}
        alt=""
        aria-hidden="true"
      />
      {celebration ? (
        <>
          <img
            className="evolution-confetti evolution-confetti--back"
            src={CONFETTI}
            alt=""
            aria-hidden="true"
          />
          <img
            className="evolution-confetti evolution-confetti--front"
            src={CONFETTI}
            alt=""
            aria-hidden="true"
          />
        </>
      ) : null}
      {failure ? (
        <img
          className="evolution-failure-motes"
          src={FAILURE_MOTES}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      {children}
    </div>
  );
}

function EvolutionPet({
  path,
  alt,
  className,
}: {
  path: string | null;
  alt: string;
  className: string;
}): ReactNode {
  return (
    <div className={`evolution-stage-pet ${className}`}>
      {path ? (
        <CatalogImage
          path={path}
          alt={alt}
          variant="detail"
          loading="eager"
          fetchPriority="high"
        />
      ) : null}
    </div>
  );
}

function SettlementDetails({
  result,
  success = false,
}: {
  result: EvolutionResult;
  success?: boolean;
}): ReactNode {
  return (
    <details className="evolution-settlement-details">
      <summary>查看结算详情</summary>
      <dl className="result-summary">
        <div>
          <dt>结算结果</dt>
          <dd>
            {result.attempt_count} 次 · 成功 {result.success_count} · 失败{" "}
            {result.failure_count}
          </dd>
        </div>
        <div>
          <dt>实际扣除材料</dt>
          <dd>
            {result.source.name} ×{result.materials.consumed}
          </dd>
        </div>
        <div>
          <dt>失败保留材料</dt>
          <dd>×{result.materials.retained}</dd>
        </div>
        <div>
          <dt>实际扣除 Fgems</dt>
          <dd>{result.fgems_spent}</dd>
        </div>
        {success ? (
          <div>
            <dt>本批保底成功</dt>
            <dd>{result.pity.guaranteed_attempts} 次</dd>
          </div>
        ) : null}
        <div>
          <dt>路线保底</dt>
          <dd>{resultPityDistance(result)}</dd>
        </div>
      </dl>
    </details>
  );
}

function evolutionPresentation(
  input: unknown,
  result: EvolutionResult | null,
): EvolutionPresentation {
  const parsedInput = routeById("inventory.evolve").input.safeParse(input);
  const sourceTemplateId =
    result?.source.template_id ??
    (parsedInput.success ? parsedInput.data.template_id : null);
  const route = sourceTemplateId ? evolutionRoute(sourceTemplateId) : undefined;
  return {
    sourceName: result?.source.name ?? "原藏品",
    sourceImagePath:
      result?.source.image_detail_path ??
      (sourceTemplateId ? catalogDetailPath(sourceTemplateId) : null),
    targetImagePath:
      result?.target.image_detail_path ??
      (route ? thumbnailToDetail(route.target.image_thumbnail_path) : null),
  };
}

function catalogDetailPath(templateId: string): string {
  return `/assets/catalog/v1/detail/${templateId.toLowerCase()}.webp`;
}

function thumbnailToDetail(path: string): string {
  return path.replace("/thumb/", "/detail/");
}

function resultPityDistance(result: EvolutionResult): string {
  const remaining = result.pity.failures_until_guaranteed;
  return remaining === 0
    ? "下次进化必定成功"
    : `再失败 ${remaining} 次后，下次进化必定成功`;
}
