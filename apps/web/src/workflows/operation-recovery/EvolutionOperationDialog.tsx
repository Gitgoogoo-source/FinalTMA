import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  EvolutionRejectedResult,
  RouteInput,
  RouteOutput,
} from "@pokepets/api-contracts/app-client";
import { X } from "lucide-react";

import { evolutionRoute } from "../../domains/evolution/config.ts";
import { useCatalogQuery } from "../../platform/query/useCatalogQuery.ts";
import { haptic, selectionHaptic } from "../../platform/telegram/index.ts";
import { Badge } from "../../shared/ui/Badge.tsx";
import { Button } from "../../shared/ui/Button.tsx";
import { CatalogImage } from "../../shared/ui/CatalogImage.tsx";
import type { OperationPhase } from "./context.ts";
import { localized, t, tp } from "../../platform/i18n/index.ts";

type EvolutionResult = RouteOutput<"inventory.evolve">;
type Rarity = EvolutionResult["target"]["rarity"];
type SuccessAction = "inventory" | "album";

type EvolutionPresentation = {
  sourceName: string;
  sourceImageUrl: string | null;
  targetImageUrl: string | null;
};

const CEREMONY_DURATION_MS = 5_000;
const STAGE_BACKGROUND = "/assets/evolution/eclipse-stage.webp";
const CONFETTI = "/assets/evolution/confetti.webp";
const FAILURE_MOTES = "/assets/evolution/failure-motes.webp";

const rarityLabels: Record<Rarity, string> = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
});
const rejectedMessages: Record<string, string> = localized({
  EVOLUTION_NOT_AVAILABLE: "藏品状态已经变化，请重新选择",
  INSUFFICIENT_INVENTORY: "可用数量已经变化，请重新选择",
  INSUFFICIENT_BALANCE: "Gems 不足，无法进化",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
});

export function EvolutionOperationDialog({
  operationId,
  phase,
  input,
  result,
  rejectedResult,
  errorCode,
  busy,
  actionError,
  onRecover,
  onSuccess,
  onAcknowledge,
}: {
  operationId: string;
  phase: OperationPhase;
  input: RouteInput<"inventory.evolve"> | null;
  result: EvolutionResult | null;
  rejectedResult: EvolutionRejectedResult | null;
  errorCode: string | null;
  busy: boolean;
  actionError: string | null;
  onRecover(): void;
  onSuccess(action: SuccessAction): void;
  onAcknowledge(): void;
}): ReactNode {
  const confirmedResult = result;
  const catalog = useCatalogQuery();
  const presentation = useMemo(
    () =>
      evolutionPresentation(input, confirmedResult, catalog.data?.templates),
    [catalog.data?.templates, confirmedResult, input],
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
    const code = rejectedResult?.error_code ?? errorCode;
    return (
      <EvolutionStage className="evolution-stage--rejected">
        <EvolutionPet
          url={presentation.sourceImageUrl}
          alt={presentation.sourceName}
          className="evolution-stage-pet--restored"
        />
        <section className="evolution-result-panel evolution-result-panel--dismissible">
          <EvolutionResultClose disabled={busy} onClick={onAcknowledge} />
          <p className="evolution-result-kicker">{t("本次没有产生结算")}</p>
          <h2 id="evolution-result-title">{t("进化未执行")}</h2>
          <p>
            {rejectedMessages[code ?? ""] ??
              t("进化仪式暂时无法开始，请稍后重试")}
          </p>
          {actionError ? (
            <p className="operation-ack-error">{actionError}</p>
          ) : null}
          <Button disabled={busy} onClick={onAcknowledge}>
            {busy ? t("正在返回") : t("返回藏品页")}
          </Button>
        </section>
      </EvolutionStage>
    );
  }

  return (
    <EvolutionStage className="evolution-stage--interrupted">
      <EvolutionPet
        url={presentation.sourceImageUrl}
        alt={presentation.sourceName}
        className="evolution-stage-pet--restored"
      />
      <section className="evolution-result-panel">
        <p className="evolution-result-kicker">{t("藏品保持原形态")}</p>
        <h2 id="evolution-result-title">{t("进化中断")}</h2>
        <p>{t("进化仪式被打断，请重新确认结果")}</p>
        <Button onClick={onRecover}>{t("重新确认")}</Button>
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
        {t("进化仪式")}
      </h2>
      <p className="evolution-ceremony-copy" aria-hidden="true">
        {t("进化")}
      </p>
      <EvolutionPet
        url={presentation.targetImageUrl}
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
        url={result.target.image_detail_url}
        alt={t(result.target.name)}
        className="evolution-stage-pet--revealed"
      />
      <h2 id="evolution-result-title" className="evolution-stage-callout">
        {t("进化成功")}
      </h2>
      <section className="evolution-result-panel evolution-result-panel--dismissible evolution-success-panel">
        <EvolutionResultClose
          disabled={busy}
          onClick={() => onSuccess("inventory")}
        />
        <header>
          <p className="evolution-result-kicker">{t("进化成功")}</p>
          <h3>{t(result.target.name)}</h3>
          <Badge>
            {tp("{{0}} · 第 {{1}} 阶", [
              rarityLabels[result.target.rarity],
              result.target.stage,
            ])}
          </Badge>
        </header>
        <div className="evolution-result-award">
          <b className="new-indicator">NEW</b>
          <strong>{tp("获得 ×{{0}}", [result.target_awarded])}</strong>
          <span>{result.new_album ? t("首次点亮图鉴") : t("图鉴已点亮")}</span>
        </div>
        <SettlementDetails result={result} success />
        {actionError ? (
          <p className="operation-ack-error">{actionError}</p>
        ) : null}
        <div className="button-row">
          <Button disabled={busy} onClick={() => onSuccess("inventory")}>
            {busy ? t("正在整理奖励") : t("查看藏品")}
          </Button>
          <Button
            className="secondary"
            disabled={busy}
            onClick={() => onSuccess("album")}
          >
            {t("查看图鉴")}
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
        url={result.source.image_detail_url}
        alt={tp("{{0}}的黑影", [t(result.source.name)])}
        className="evolution-stage-pet--failure-silhouette"
      />
      <section className="evolution-result-panel evolution-result-panel--dismissible evolution-failure-panel">
        <EvolutionResultClose disabled={busy} onClick={onAcknowledge} />
        <p className="evolution-result-kicker">{t("藏品保持原形态")}</p>
        <h2 id="evolution-result-title">{t("进化失败")}</h2>
        <p>
          {tp("只留下 {{0}} 的黑色轮廓，本次没有获得 {{1}}。", [
            t(result.source.name),
            t(result.target.name),
          ])}
        </p>
        <SettlementDetails result={result} />
        {actionError ? (
          <p className="operation-ack-error">{actionError}</p>
        ) : null}
        <Button disabled={busy} onClick={onAcknowledge}>
          {busy ? t("正在整理结果") : t("知道了")}
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
      aria-label={t("关闭进化结果并返回藏品页")}
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
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className: string;
}): ReactNode {
  return (
    <div className={`evolution-stage-pet ${className}`}>
      {url ? (
        <CatalogImage
          url={url}
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
      <summary>{t("查看结算详情")}</summary>
      <dl className="result-summary">
        <div>
          <dt>{t("结算结果")}</dt>
          <dd>
            {tp("{{0}} 次 · 成功 {{1}} · 失败 {{2}}", [
              result.attempt_count,
              result.success_count,
              result.failure_count,
            ])}
          </dd>
        </div>
        <div>
          <dt>{t("实际扣除材料")}</dt>
          <dd>
            {t(result.source.name)} ×{result.materials.consumed}
          </dd>
        </div>
        <div>
          <dt>{t("失败保留材料")}</dt>
          <dd>×{result.materials.retained}</dd>
        </div>
        <div>
          <dt>{t("实际扣除 Gems")}</dt>
          <dd>{result.fgems_spent}</dd>
        </div>
        {success ? (
          <div>
            <dt>{t("本批保底成功")}</dt>
            <dd>{tp("{{0}} 次", [result.pity.guaranteed_attempts])}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("路线保底")}</dt>
          <dd>{resultPityDistance(result)}</dd>
        </div>
      </dl>
    </details>
  );
}

function evolutionPresentation(
  input: RouteInput<"inventory.evolve"> | null,
  result: EvolutionResult | null,
  templates:
    | ReadonlyArray<{
        id: string;
        name: string;
        image_detail_url: string;
      }>
    | undefined,
): EvolutionPresentation {
  const sourceTemplateId =
    result?.source.template_id ?? input?.template_id ?? null;
  const route = sourceTemplateId ? evolutionRoute(sourceTemplateId) : undefined;
  const source = templates?.find(
    (template) => template.id === sourceTemplateId,
  );
  const target = templates?.find(
    (template) => template.id === route?.target.template_id,
  );
  return {
    sourceName: t(result?.source.name ?? source?.name ?? "原藏品"),
    sourceImageUrl:
      result?.source.image_detail_url ?? source?.image_detail_url ?? null,
    targetImageUrl:
      result?.target.image_detail_url ?? target?.image_detail_url ?? null,
  };
}

function resultPityDistance(result: EvolutionResult): string {
  const remaining = result.pity.failures_until_guaranteed;
  return remaining === 0
    ? t("下次进化必定成功")
    : tp("再失败 {{0}} 次后，下次进化必定成功", [remaining]);
}
