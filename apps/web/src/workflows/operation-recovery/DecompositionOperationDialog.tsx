import { useEffect, useRef, useState, type ReactNode } from "react";
import { routeById, type RouteOutput } from "@pokepets/api-contracts/app";

import { haptic, selectionHaptic } from "../../platform/telegram/index.ts";
import { Button, CatalogImage } from "../../shared/ui/index.tsx";
import type { OperationPhase, OperationPresentation } from "./context.ts";

type DecompositionResult = RouteOutput<"inventory.decompose">;

const CEREMONY_DURATION_MS = 2_000;
const STAGE_BACKGROUND = "/assets/decomposition/ritual-stage.webp";
const rejectedMessages: Record<string, string> = {
  INSUFFICIENT_INVENTORY: "可用数量已变化，请重新确认",
  INVENTORY_RESERVED: "藏品状态已变化，请刷新后重试",
  IDEMPOTENCY_KEY_REUSED: "藏品状态已变化，请刷新后重试",
  INTERNAL_ERROR: "分解失败，请稍后重试",
};

export function DecompositionOperationDialog({
  operationId,
  phase,
  result,
  errorCode,
  presentation,
  onRecover,
  onCollect,
}: {
  operationId: string;
  phase: OperationPhase;
  result: unknown;
  errorCode: string | null;
  presentation: OperationPresentation | null;
  onRecover(): void;
  onCollect(): void;
}): ReactNode {
  const parsed = routeById("inventory.decompose").output.safeParse(result);
  const confirmedResult = parsed.success ? parsed.data : null;
  const [ceremonyComplete, setCeremonyComplete] = useState(false);
  const announcedOutcome = useRef<string | null>(null);

  useEffect(() => {
    const pulseTimers = [420, 1_120, 1_720].map((delay) =>
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
        ? "success"
        : phase === "failed"
          ? "failed"
          : "waiting";
    if (outcome === "waiting" || announcedOutcome.current === outcome) return;
    announcedOutcome.current = outcome;
    haptic(outcome === "success" ? "success" : "error");
  }, [ceremonyComplete, confirmedResult, phase]);

  if (!ceremonyComplete)
    return <DecompositionCeremony presentation={presentation} />;

  if (phase === "succeeded" && confirmedResult)
    return (
      <DecompositionSuccess
        result={confirmedResult}
        presentation={presentation}
        onCollect={onCollect}
      />
    );

  if (phase === "failed")
    return (
      <DecompositionStage className="decomposition-stage--failed">
        <RestoredPet presentation={presentation} />
        <section className="decomposition-result" aria-live="polite">
          <p className="decomposition-result-kicker">宠物安然无恙</p>
          <h2 id="decomposition-result-title">分解未完成</h2>
          <p>{rejectedMessages[errorCode ?? ""] ?? "分解失败，请稍后重试"}</p>
          <Button onClick={onCollect}>返回藏品页</Button>
        </section>
      </DecompositionStage>
    );

  return (
    <DecompositionStage className="decomposition-stage--waiting">
      <section className="decomposition-result" aria-live="polite">
        <p className="decomposition-result-kicker">晶辉仍在凝聚</p>
        <h2 id="decomposition-result-title">仪式尚未结束</h2>
        <p>请让这束晶辉继续完成变化</p>
        <Button onClick={onRecover}>继续凝聚</Button>
      </section>
    </DecompositionStage>
  );
}

function DecompositionCeremony({
  presentation,
}: {
  presentation: OperationPresentation | null;
}): ReactNode {
  return (
    <DecompositionStage className="decomposition-ceremony-stage">
      <h2
        id="decomposition-result-title"
        className="decomposition-stage-sr-title"
      >
        分解仪式
      </h2>
      <ShatteringPet presentation={presentation} />
    </DecompositionStage>
  );
}

function DecompositionSuccess({
  result,
  presentation,
  onCollect,
}: {
  result: DecompositionResult;
  presentation: OperationPresentation | null;
  onCollect(): void;
}): ReactNode {
  const name = presentation?.name ?? "当前宠物";
  return (
    <DecompositionStage className="decomposition-stage--success">
      <section className="decomposition-result" aria-live="polite">
        <p className="decomposition-result-kicker">分解完成</p>
        <h2 id="decomposition-result-title">
          <strong>+{result.fgems_earned}</strong>
          <span>Fgems</span>
        </h2>
        <p>
          {name} × {result.quantity} 已化作晶辉
        </p>
        <Button onClick={onCollect}>收下</Button>
      </section>
    </DecompositionStage>
  );
}

function DecompositionStage({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`decomposition-stage ${className}`}>
      <img
        className="decomposition-stage-background"
        src={STAGE_BACKGROUND}
        alt=""
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

function ShatteringPet({
  presentation,
}: {
  presentation: OperationPresentation | null;
}): ReactNode {
  if (!presentation?.imagePath) return null;
  return (
    <div className="decomposition-pet" aria-hidden="true">
      <PetPiece presentation={presentation} className="top" />
      <PetPiece presentation={presentation} className="middle" />
      <PetPiece presentation={presentation} className="bottom" />
    </div>
  );
}

function PetPiece({
  presentation,
  className,
}: {
  presentation: OperationPresentation;
  className: string;
}): ReactNode {
  return (
    <div
      className={`decomposition-pet-piece decomposition-pet-piece--${className}`}
    >
      <CatalogImage
        url={presentation.imagePath}
        alt=""
        variant="detail"
        loading="eager"
        fetchPriority="high"
      />
    </div>
  );
}

function RestoredPet({
  presentation,
}: {
  presentation: OperationPresentation | null;
}): ReactNode {
  if (!presentation?.imagePath) return null;
  return (
    <div className="decomposition-restored-pet">
      <CatalogImage
        url={presentation.imagePath}
        alt={presentation.name ?? "宠物"}
        variant="detail"
        loading="eager"
        fetchPriority="high"
      />
    </div>
  );
}
