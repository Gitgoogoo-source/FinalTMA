import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  errorDefinition,
  isErrorCode,
  isRecoverableRouteId,
  parseRecoveredOperation,
  routeById,
  type RecoverableOperationSummary,
  type RecoverableRouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app";
import { useNavigate } from "react-router-dom";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import {
  fetchApiQuery,
  refreshRouteScopes,
  refreshScopes,
} from "../../platform/query/index.ts";
import {
  getSession,
  registerSensitiveStateResetter,
  useSession,
} from "../../platform/session/store.ts";
import {
  haptic,
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { useNewMarkers } from "../new-markers/index.ts";
import { useNavigationIntent } from "../payment-recovery/index.ts";
import { AlbumClaimResultDialog } from "./AlbumClaimResultDialog.tsx";
import {
  OperationRegistryContext,
  type OperationPhase,
  type OperationPresentation,
  type OperationRegistryValue,
} from "./context.ts";
import { DecompositionOperationDialog } from "./DecompositionOperationDialog.tsx";
import { EvolutionOperationDialog } from "./EvolutionOperationDialog.tsx";
import {
  GachaHatchAnimation,
  type GachaHatchTier,
} from "./GachaHatchAnimation.tsx";
import { GachaResultDialog } from "./GachaResultDialog.tsx";
import { operationLabel } from "./labels.ts";
import { WheelResultDialog } from "./WheelResultDialog.tsx";
import "./gacha-ritual.css";
import "./gacha-ten-stage.css";
import { markOperationNewTemplates } from "./operation-new-markers.ts";
import {
  MarketListingFailureDialog,
  MarketListingSuccessDialog,
} from "./MarketListingResultDialog.tsx";
import {
  MarketPurchaseFailureDialog,
  MarketPurchaseSuccessDialog,
} from "./MarketPurchaseResultDialog.tsx";

type RegisteredOperation = {
  id: string;
  sessionGeneration: string;
  routeId: RecoverableRouteId;
  label: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
  persistent: boolean;
  input: unknown;
  presentation: OperationPresentation | null;
  animationTier: GachaHatchTier | null;
  terminalPresentationAllowed: boolean;
};

type EvolutionResultAction = "inventory" | "album" | "acknowledge";
type GachaResult = RouteOutput<"gacha.open">;
type MarketPurchasePresentationResult = {
  name: string;
  result: RouteOutput<"market.purchase">;
};
const unresolvedPhases = new Set<OperationPhase>([
  "confirming",
  "submitting",
  "pending",
  "unknown",
]);
const serverAcknowledgementRouteIds = new Set<RecoverableRouteId>([
  "inventory.evolve",
]);
const navigationLockedThroughResultRouteIds = new Set<RecoverableRouteId>([
  "gacha.open",
  "inventory.decompose",
  "wheel.spin",
]);
const autoPollingRouteIds = new Set<RecoverableRouteId>([
  "wheel.spin",
  "market.create_listing",
  "market.purchase",
  ...serverAcknowledgementRouteIds,
  "gacha.open",
  "inventory.decompose",
]);
const refreshBeforeSuccessRouteIds = new Set<RecoverableRouteId>([
  "market.create_listing",
  "market.purchase",
]);
const externallyRenderedSuccessRouteIds = new Set<RecoverableRouteId>([
  "expedition.create",
  "mint.cancel",
  "mint.reserve",
  "referral.bind",
  "topup.cancel_order",
  "topup.create_order",
  "topup.fail_order",
  "vip.cancel_order",
  "vip.claim_fgems",
  "vip.claim_free_box",
  "vip.create_order",
  "wallet.disconnect",
  "wallet.verify",
]);
const playerFacingMarketListingErrorCodes = new Set([
  "ACCOUNT_RESTRICTED",
  "INSUFFICIENT_INVENTORY",
  "MARKET_ACTIVE_TEMPLATE_LIMIT",
  "TEMPLATE_NOT_FOUND",
]);
const playerFacingMarketPurchaseErrorCodes = new Set([
  "INSUFFICIENT_BALANCE",
  "MARKET_STOCK_INSUFFICIENT",
  "TEMPLATE_NOT_FOUND",
]);

export function OperationRegistryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const session = useSession();
  const { markNew } = useNewMarkers();
  const { requestTopup } = useNavigationIntent();
  const [operations, setOperations] = useState<
    Record<string, RegisteredOperation>
  >({});
  const operationsRef = useRef(operations);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [acknowledgementError, setAcknowledgementError] = useState<{
    operationId: string;
    message: string;
  } | null>(null);
  const [gachaActionId, setGachaActionId] = useState<string | null>(null);
  const [gachaActionError, setGachaActionError] = useState<{
    operationId: string;
    message: string;
  } | null>(null);
  const [revealedGachaAnimationId, setRevealedGachaAnimationId] = useState<
    string | null
  >(null);
  const [wheelPresentationEpoch, setWheelPresentationEpoch] = useState(0);
  const recoveringIds = useRef(new Set<string>());
  const acknowledgedIds = useRef(new Set<string>());
  const locallyRefreshedEvolutionIds = useRef(new Set<string>());
  const needsAuthorityRefreshAfterLeave = useRef(new Set<RecoverableRouteId>());
  const active = activeId ? operations[activeId] : undefined;
  const recoveryQueueActive = Object.values(operations).some(
    (operation) =>
      operation.sessionGeneration === session?.generation &&
      (serverAcknowledgementRouteIds.has(operation.routeId) ||
        (operation.routeId === "wheel.spin" &&
          unresolvedPhases.has(operation.phase))),
  );
  const gachaResult = useMemo(() => {
    if (active?.routeId !== "gacha.open" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("gacha.open").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const wheelResult = useMemo(() => {
    if (active?.routeId !== "wheel.spin" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("wheel.spin").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const albumClaimResult = useMemo(() => {
    if (active?.routeId !== "album.claim" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("album.claim").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const marketPurchaseResult =
    useMemo<MarketPurchasePresentationResult | null>(() => {
      if (active?.routeId !== "market.purchase" || active.phase !== "succeeded")
        return null;
      const input = routeById("market.purchase").input.safeParse(active.input);
      const result = routeById("market.purchase").output.safeParse(
        active.result,
      );
      if (
        !input.success ||
        !result.success ||
        result.data.template_id !== input.data.template_id ||
        !active.presentation?.name
      )
        return null;
      return { name: active.presentation.name, result: result.data };
    }, [active]);
  const invalidGachaSuccess = Boolean(
    active?.routeId === "gacha.open" &&
    active.phase === "succeeded" &&
    !gachaResult,
  );
  const invalidWheelSuccess = Boolean(
    active?.routeId === "wheel.spin" &&
    active.phase === "succeeded" &&
    !wheelResult,
  );
  const invalidAlbumClaimSuccess = Boolean(
    active?.routeId === "album.claim" &&
    active.phase === "succeeded" &&
    !albumClaimResult,
  );
  const invalidDedicatedSuccess =
    invalidGachaSuccess || invalidWheelSuccess || invalidAlbumClaimSuccess;
  const unresolved = Object.values(operations).filter((operation) =>
    unresolvedPhases.has(operation.phase),
  );
  const resumableUnresolved = unresolved.filter(
    (operation) =>
      operation.routeId !== "market.create_listing" &&
      operation.routeId !== "market.purchase",
  );
  const navigationLocked = Object.values(operations).some(
    (operation) =>
      operation.sessionGeneration === session?.generation &&
      (navigationLockedThroughResultRouteIds.has(operation.routeId) ||
        (operation.routeId === "inventory.evolve" &&
          unresolvedPhases.has(operation.phase))),
  );
  const closingBlocked = unresolved.some(
    (operation) =>
      operation.phase === "confirming" || operation.phase === "submitting",
  );
  const animatedGachaOperationId =
    active?.routeId === "gacha.open" && active.animationTier !== null
      ? active.id
      : null;
  const gachaPresentationReady =
    animatedGachaOperationId === null ||
    revealedGachaAnimationId === animatedGachaOperationId;
  const showGachaAnimation = Boolean(
    active?.routeId === "gacha.open" &&
    (!gachaPresentationReady || unresolvedPhases.has(active.phase)),
  );
  const hideMarketProgress = Boolean(
    (active?.routeId === "market.create_listing" ||
      active?.routeId === "market.purchase") &&
    unresolvedPhases.has(active.phase),
  );
  const showOperationDialog =
    session?.accountStatus === "normal" && !hideMarketProgress;

  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);

  useEffect(
    () =>
      registerSensitiveStateResetter(() => {
        operationsRef.current = {};
        recoveringIds.current.clear();
        acknowledgedIds.current.clear();
        locallyRefreshedEvolutionIds.current.clear();
        setOperations({});
        setActiveId(null);
        setAcknowledgingId(null);
        setAcknowledgementError(null);
        setGachaActionId(null);
        setGachaActionError(null);
        setRevealedGachaAnimationId(null);
        setWheelPresentationEpoch((current) => current + 1);
        needsAuthorityRefreshAfterLeave.current.clear();
        telegram()?.disableClosingConfirmation();
      }),
    [],
  );

  useEffect(() => {
    if (closingBlocked) telegram()?.enableClosingConfirmation();
    else telegram()?.disableClosingConfirmation();
    return () => telegram()?.disableClosingConfirmation();
  }, [closingBlocked]);

  useEffect(() => {
    if (!animatedGachaOperationId) return;
    const operationId = animatedGachaOperationId;
    let timer: number | undefined;
    const finishCycle = () => {
      const operation = operationsRef.current[operationId];
      if (operation?.phase === "succeeded" || operation?.phase === "failed") {
        setRevealedGachaAnimationId(operationId);
        return;
      }
      timer = window.setTimeout(finishCycle, 3_000);
    };
    timer = window.setTimeout(finishCycle, 3_000);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [animatedGachaOperationId]);

  useLayoutEffect(() => {
    if (!activeId || !dialogRef.current) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current.focus();
    return () => {
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected && !previousFocus.matches(":disabled"))
          previousFocus.focus();
      });
    };
  }, [activeId, hideMarketProgress]);

  const update = useCallback(
    (id: string, change: Partial<RegisteredOperation>) => {
      const current = operationsRef.current;
      if (
        !current[id] ||
        current[id].sessionGeneration !== getSession()?.generation ||
        getSession()?.accountStatus !== "normal"
      )
        return;
      const next = { ...current, [id]: { ...current[id], ...change } };
      operationsRef.current = next;
      setOperations(next);
    },
    [],
  );

  const remove = useCallback((id: string) => {
    locallyRefreshedEvolutionIds.current.delete(id);
    const next = Object.fromEntries(
      Object.entries(operationsRef.current).filter(
        ([operationId]) => operationId !== id,
      ),
    );
    operationsRef.current = next;
    setOperations(next);
    setActiveId((current) =>
      current === id ? (Object.keys(next)[0] ?? null) : current,
    );
  }, []);

  const refreshAuthorityAfterLeave = useCallback(() => {
    const routeIds = [...needsAuthorityRefreshAfterLeave.current];
    if (routeIds.length === 0) return;
    needsAuthorityRefreshAfterLeave.current.clear();
    const scopes = [
      ...new Set(
        routeIds.flatMap((routeId) => routeById(routeId).refreshScopes),
      ),
    ];
    void refreshScopes(scopes, { throwOnError: true }).catch(() => {
      if (getSession()?.accountStatus !== "normal") return;
      for (const routeId of routeIds)
        needsAuthorityRefreshAfterLeave.current.add(routeId);
    });
  }, []);

  const discardTransientPresentations = useCallback(() => {
    const current = operationsRef.current;
    const discardedGachaIds = new Set<string>();
    const hiddenPresentationIds = new Set<string>();
    let wheelPresentationDiscarded = false;
    const next: Record<string, RegisteredOperation> = {};
    for (const [operationId, operation] of Object.entries(current)) {
      if (serverAcknowledgementRouteIds.has(operation.routeId)) {
        next[operationId] = operation;
        continue;
      }
      hiddenPresentationIds.add(operationId);
      needsAuthorityRefreshAfterLeave.current.add(operation.routeId);
      if (operation.routeId === "gacha.open") {
        discardedGachaIds.add(operationId);
        continue;
      }
      if (operation.routeId === "wheel.spin") wheelPresentationDiscarded = true;
      if (unresolvedPhases.has(operation.phase))
        next[operationId] = {
          ...operation,
          terminalPresentationAllowed: false,
        };
    }
    if (hiddenPresentationIds.size === 0) return;
    if (wheelPresentationDiscarded)
      setWheelPresentationEpoch((currentEpoch) => currentEpoch + 1);
    operationsRef.current = next;
    setOperations(next);
    setActiveId((id) => (id && hiddenPresentationIds.has(id) ? null : id));
    setGachaActionId((id) => (id && discardedGachaIds.has(id) ? null : id));
    setGachaActionError((error) =>
      error && discardedGachaIds.has(error.operationId) ? null : error,
    );
    setRevealedGachaAnimationId((id) =>
      id && discardedGachaIds.has(id) ? null : id,
    );
  }, []);

  useEffect(() => {
    const restore = () => {
      if (getSession()?.accountStatus !== "normal") return;
      refreshAuthorityAfterLeave();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") restore();
      else discardTransientPresentations();
    };
    const unsubscribe = subscribeTelegramActivity(
      restore,
      discardTransientPresentations,
    );
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", discardTransientPresentations);
    window.addEventListener("pageshow", restore);
    window.addEventListener("online", restore);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", discardTransientPresentations);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("online", restore);
    };
  }, [discardTransientPresentations, refreshAuthorityAfterLeave]);

  const refreshAfterLocalSettlement = useCallback(
    async (id: string, routeId: RecoverableRouteId) => {
      try {
        await refreshRouteScopes(routeId, { throwOnError: true });
        if (
          routeId === "inventory.evolve" &&
          operationsRef.current[id]?.sessionGeneration ===
            getSession()?.generation
        )
          locallyRefreshedEvolutionIds.current.add(id);
      } catch {
        return;
      }
    },
    [],
  );

  const run: OperationRegistryValue["run"] = useCallback(
    async <Id extends RecoverableRouteId>(
      label: string,
      routeId: Id,
      input: RouteInput<Id>,
      options?: {
        background?: boolean;
        dialog?: boolean;
        presentation?: OperationPresentation;
        retainOnFailure?: boolean;
      },
    ): Promise<RouteOutput<Id> | null> => {
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return null;
      if (options?.background) {
        try {
          const response = await apiRequest(routeId, input, {
            idempotencyKey: newIdempotencyKey(),
          });
          if (isCurrentNormalSession(sessionGeneration)) {
            if (response.status !== 202)
              markOperationNewTemplates(routeId, response.data, markNew);
            await refreshRouteScopes(routeId).catch(() => undefined);
          }
          return isCurrentNormalSession(sessionGeneration)
            ? response.data
            : null;
        } catch {
          if (isCurrentNormalSession(sessionGeneration))
            await refreshRouteScopes(routeId).catch(() => undefined);
          return null;
        }
      }
      const existing = Object.values(operationsRef.current).find(
        (operation) =>
          operation.sessionGeneration === sessionGeneration &&
          operation.routeId === routeId &&
          (unresolvedPhases.has(operation.phase) ||
            navigationLockedThroughResultRouteIds.has(routeId)),
      );
      if (existing) {
        if (options?.dialog !== false) setActiveId(existing.id);
        return null;
      }
      const id = newIdempotencyKey();
      const next = {
        ...operationsRef.current,
        [id]: {
          id,
          sessionGeneration,
          routeId,
          label,
          phase: "confirming",
          message: "正在确认本次操作",
          result: null,
          errorCode: null,
          persistent: false,
          input,
          presentation: options?.presentation ?? null,
          animationTier:
            routeId === "gacha.open" ? gachaAnimationTier(input, null) : null,
          terminalPresentationAllowed: true,
        },
      } satisfies Record<string, RegisteredOperation>;
      operationsRef.current = next;
      setOperations(next);
      if (options?.dialog !== false) setActiveId(id);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!isCurrentNormalSession(sessionGeneration)) return null;
      update(id, {
        phase: "submitting",
        message: "已提交，正在等待服务器裁决",
      });
      try {
        const response = await apiRequest(routeId, input, {
          idempotencyKey: id,
        });
        if (!isCurrentNormalSession(sessionGeneration)) {
          if (getSession()?.accountStatus === "normal")
            await refreshRouteScopes(routeId);
          return null;
        }
        const pending = response.status === 202;
        const refreshBeforeSuccess =
          !pending && refreshBeforeSuccessRouteIds.has(routeId);
        if (refreshBeforeSuccess) {
          update(id, { message: refreshingAuthorityMessage(routeId) });
          try {
            await refreshRouteScopes(routeId, { throwOnError: true });
          } catch {
            update(id, {
              phase: "unknown",
              message: syncingAuthorityMessage(routeId),
            });
            return null;
          }
          if (!isCurrentNormalSession(sessionGeneration)) return null;
        }
        if (!pending && externallyRenderedSuccessRouteIds.has(routeId))
          remove(id);
        else
          update(id, {
            phase: pending ? "pending" : "succeeded",
            message: pending
              ? "服务器已接收，最终结果仍在确认"
              : confirmedMessage(routeId, response.data),
            result: response.data,
            persistent: true,
          });
        if (!pending)
          markOperationNewTemplates(routeId, response.data, markNew);
        const suppressTerminalPresentation =
          !pending &&
          !serverAcknowledgementRouteIds.has(routeId) &&
          operationsRef.current[id]?.terminalPresentationAllowed !== true;
        if (
          !suppressTerminalPresentation &&
          routeId !== "inventory.evolve" &&
          routeId !== "inventory.decompose"
        )
          haptic(pending ? "warning" : "success");
        if (!refreshBeforeSuccess) {
          if (pending) await refreshRouteScopes(routeId).catch(() => undefined);
          else await refreshAfterLocalSettlement(id, routeId);
        }
        if (suppressTerminalPresentation) {
          remove(id);
          return null;
        }
        return response.data;
      } catch (cause) {
        if (!isCurrentNormalSession(sessionGeneration)) {
          if (getSession()?.accountStatus === "normal")
            await refreshRouteScopes(routeId);
          return null;
        }
        const failure =
          cause instanceof ApiFailure
            ? cause
            : new ApiFailure(
                0,
                "INTERNAL_ERROR",
                "操作结果暂时无法确认",
                true,
                id,
              );
        const unknown =
          Boolean(failure.operationId) &&
          ([
            "NETWORK_ERROR",
            "OPERATION_RESULT_INVALID",
            "RESPONSE_INVALID",
          ].includes(failure.code) ||
            !(cause instanceof ApiFailure));
        if (options?.dialog === false && !options.retainOnFailure && !unknown)
          remove(id);
        else
          update(id, {
            phase: unknown ? "unknown" : "failed",
            message: unknown
              ? failure.code === "NETWORK_ERROR"
                ? "网络中断，必须查询原操作，不能重复提交"
                : "原操作结果详情暂时无法确认，必须查询原操作"
              : failure.message,
            errorCode: failure.code,
            persistent: Boolean(failure.operationId),
          });
        const suppressTerminalPresentation =
          !unknown &&
          !serverAcknowledgementRouteIds.has(routeId) &&
          operationsRef.current[id]?.terminalPresentationAllowed !== true;
        if (
          !suppressTerminalPresentation &&
          routeId !== "inventory.evolve" &&
          routeId !== "inventory.decompose"
        )
          haptic("error");
        if (!unknown) await refreshAfterLocalSettlement(id, routeId);
        if (suppressTerminalPresentation) remove(id);
        return null;
      }
    },
    [markNew, refreshAfterLocalSettlement, remove, update],
  );

  const present = useCallback((routeId: RecoverableRouteId): boolean => {
    const sessionGeneration = getSession()?.generation;
    if (!sessionGeneration || getSession()?.accountStatus !== "normal")
      return false;
    const operation = Object.values(operationsRef.current).find(
      (candidate) =>
        candidate.sessionGeneration === sessionGeneration &&
        candidate.routeId === routeId &&
        (unresolvedPhases.has(candidate.phase) ||
          candidate.terminalPresentationAllowed),
    );
    if (!operation) return false;
    setActiveId(operation.id);
    return true;
  }, []);

  const hydrate = useCallback(
    (incoming: readonly RecoverableOperationSummary[]) => {
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return;
      const next = { ...operationsRef.current };
      const completedOutsideRegistry = new Set<string>();
      let firstId: string | null = null;
      for (const operation of incoming) {
        if (operation.use_case === "gacha.open") {
          delete next[operation.operation_id];
          completedOutsideRegistry.add(operation.operation_id);
          needsAuthorityRefreshAfterLeave.current.add(operation.use_case);
          continue;
        }
        if (!isRecoverableRouteId(operation.use_case)) continue;
        if (
          !serverAcknowledgementRouteIds.has(operation.use_case) &&
          (operation.status === "succeeded" || operation.status === "failed")
        ) {
          delete next[operation.operation_id];
          completedOutsideRegistry.add(operation.operation_id);
          needsAuthorityRefreshAfterLeave.current.add(operation.use_case);
          continue;
        }
        if (
          operation.acknowledged_at !== null ||
          acknowledgedIds.current.has(operation.operation_id)
        )
          continue;
        if (
          operation.status === "succeeded" &&
          externallyRenderedSuccessRouteIds.has(operation.use_case)
        ) {
          delete next[operation.operation_id];
          completedOutsideRegistry.add(operation.operation_id);
          markOperationNewTemplates(
            operation.use_case,
            operation.result,
            markNew,
          );
          continue;
        }
        if (operation.use_case !== "wheel.spin")
          firstId ??= operation.operation_id;
        next[operation.operation_id] = {
          id: operation.operation_id,
          sessionGeneration,
          routeId: operation.use_case,
          label: operationLabel(operation.use_case),
          phase: operation.status,
          message: recoveredMessage(operation),
          result: operation.result,
          errorCode: operation.error_code,
          persistent: true,
          input: null,
          presentation: next[operation.operation_id]?.presentation ?? null,
          animationTier: next[operation.operation_id]?.animationTier ?? null,
          terminalPresentationAllowed:
            next[operation.operation_id]?.terminalPresentationAllowed ??
            serverAcknowledgementRouteIds.has(operation.use_case),
        };
        if (operation.status === "succeeded")
          markOperationNewTemplates(
            operation.use_case,
            operation.result,
            markNew,
          );
      }
      operationsRef.current = next;
      setOperations(next);
      setActiveId((current) =>
        current && completedOutsideRegistry.has(current)
          ? firstId
          : (current ?? firstId),
      );
      refreshAuthorityAfterLeave();
    },
    [markNew, refreshAuthorityAfterLeave],
  );

  const recover = useCallback(
    async (operation: RegisteredOperation) => {
      if (
        operation.sessionGeneration !== getSession()?.generation ||
        recoveringIds.current.has(operation.id)
      )
        return;
      recoveringIds.current.add(operation.id);
      update(operation.id, { phase: "pending", message: "正在查询原操作" });
      try {
        const response = await apiRequest("operations.get", {
          operation_id: operation.id,
        });
        if (operation.sessionGeneration !== getSession()?.generation) return;
        const recovered = parseRecoveredOperation(response.data);
        if (recovered.acknowledged_at !== null) {
          remove(operation.id);
          return;
        }
        if (recovered.status === "succeeded") {
          const suppressTerminalPresentation =
            !serverAcknowledgementRouteIds.has(operation.routeId) &&
            operationsRef.current[operation.id]?.terminalPresentationAllowed !==
              true;
          if (suppressTerminalPresentation) {
            markOperationNewTemplates(
              operation.routeId,
              recovered.result,
              markNew,
            );
            await refreshRouteScopes(operation.routeId);
            remove(operation.id);
            return;
          }
          const refreshBeforeSuccess = refreshBeforeSuccessRouteIds.has(
            operation.routeId,
          );
          if (refreshBeforeSuccess) {
            update(operation.id, {
              phase: "pending",
              message: refreshingAuthorityMessage(operation.routeId),
            });
            try {
              await refreshRouteScopes(operation.routeId, {
                throwOnError: true,
              });
            } catch {
              update(operation.id, {
                phase: "unknown",
                message: syncingAuthorityMessage(operation.routeId),
              });
              return;
            }
            if (
              operation.sessionGeneration !== getSession()?.generation ||
              getSession()?.accountStatus !== "normal"
            )
              return;
          }
          if (externallyRenderedSuccessRouteIds.has(operation.routeId))
            remove(operation.id);
          else
            update(operation.id, {
              phase: "succeeded",
              message: confirmedMessage(operation.routeId, recovered.result),
              result: recovered.result,
              errorCode: null,
              persistent: true,
            });
          markOperationNewTemplates(
            operation.routeId,
            recovered.result,
            markNew,
          );
          if (
            !externallyRenderedSuccessRouteIds.has(operation.routeId) &&
            serverAcknowledgementRouteIds.has(operation.routeId)
          )
            setActiveId((current) => current ?? operation.id);
          if (
            operation.routeId !== "inventory.evolve" &&
            operation.routeId !== "inventory.decompose"
          )
            haptic("success");
          if (!refreshBeforeSuccess)
            await refreshRouteScopes(operation.routeId);
        } else if (recovered.status === "failed") {
          if (
            !serverAcknowledgementRouteIds.has(operation.routeId) &&
            operationsRef.current[operation.id]?.terminalPresentationAllowed !==
              true
          ) {
            await refreshRouteScopes(operation.routeId);
            remove(operation.id);
            return;
          }
          const definition =
            recovered.error_code && isErrorCode(recovered.error_code)
              ? errorDefinition(recovered.error_code)
              : null;
          update(operation.id, {
            phase: "failed",
            message: definition?.message ?? "原操作已确认失败",
            result: recovered.result,
            errorCode: recovered.error_code,
            persistent: true,
          });
          if (serverAcknowledgementRouteIds.has(operation.routeId))
            setActiveId((current) => current ?? operation.id);
          await refreshRouteScopes(operation.routeId);
        } else {
          update(operation.id, {
            phase: recovered.status,
            message:
              recovered.status === "unknown"
                ? "原操作结果仍未知，请稍后继续查询"
                : "原操作仍在处理中",
          });
        }
      } catch (cause) {
        update(operation.id, {
          phase: "unknown",
          message:
            cause instanceof ApiFailure ? cause.message : "暂时无法查询原操作",
        });
      } finally {
        recoveringIds.current.delete(operation.id);
      }
    },
    [markNew, remove, update],
  );

  const pollingOperationId =
    active &&
    autoPollingRouteIds.has(active.routeId) &&
    ["pending", "unknown"].includes(active.phase)
      ? active.id
      : (Object.values(operations).find(
          (operation) =>
            autoPollingRouteIds.has(operation.routeId) &&
            ["pending", "unknown"].includes(operation.phase),
        )?.id ?? null);

  useEffect(() => {
    if (!pollingOperationId) return;
    const operationId = pollingOperationId;
    const delays = [1_000, 2_000, 3_000, 5_000] as const;
    let attempt = 0;
    let cancelled = false;
    let timer: number | undefined;
    const poll = () => {
      const operation = operationsRef.current[operationId];
      if (
        cancelled ||
        !operation ||
        !["pending", "unknown"].includes(operation.phase)
      )
        return;
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5_000;
      attempt += 1;
      timer = window.setTimeout(async () => {
        const current = operationsRef.current[operationId];
        if (
          cancelled ||
          !current ||
          !["pending", "unknown"].includes(current.phase)
        )
          return;
        await recover(current);
        poll();
      }, delay);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollingOperationId, recover]);

  const value = useMemo<OperationRegistryValue>(
    () => ({
      run,
      isBlocked: (routeId) =>
        Object.values(operations).some(
          (operation) =>
            operation.sessionGeneration === getSession()?.generation &&
            operation.routeId === routeId &&
            (unresolvedPhases.has(operation.phase) ||
              navigationLockedThroughResultRouteIds.has(routeId)),
        ),
      present,
      navigationLocked,
      recoveryQueueActive,
      wheelPresentationEpoch,
      hydrate,
    }),
    [
      hydrate,
      navigationLocked,
      operations,
      present,
      recoveryQueueActive,
      run,
      wheelPresentationEpoch,
    ],
  );

  const dismiss = useCallback(() => {
    if (!active) return;
    if (active.phase === "succeeded" || active.phase === "failed")
      remove(active.id);
    else setActiveId(null);
  }, [active, remove]);

  const repeatGacha = useCallback(
    async (operation: RegisteredOperation) => {
      if (
        operation.routeId !== "gacha.open" ||
        operation.phase !== "succeeded" ||
        gachaActionId
      )
        return;
      const generation = operation.sessionGeneration;
      const parsedResult = routeById("gacha.open").output.safeParse(
        operation.result,
      );
      if (!parsedResult.success) {
        setGachaActionError({
          operationId: operation.id,
          message: "开盒结果详情暂时无法读取",
        });
        return;
      }
      setGachaActionId(operation.id);
      setGachaActionError(null);
      try {
        const [bootstrap, identity] = await Promise.all([
          apiRequest("gacha.bootstrap", {}),
          fetchApiQuery("identity.bootstrap"),
        ]);
        if (
          !isCurrentNormalSession(generation) ||
          !operationsRef.current[operation.id]
        )
          return;
        const box = bootstrap.data.boxes.find(
          (candidate) => candidate.tier === parsedResult.data.tier,
        );
        if (!bootstrap.data.rules_complete || !box) {
          setGachaActionError({
            operationId: operation.id,
            message: "开盒规则加载失败，请重试",
          });
          return;
        }
        const { draw_count, tier } = parsedResult.data;
        const free =
          draw_count === 1 &&
          ((tier === "normal" &&
            bootstrap.data.entitlements.free_normal_box > 0) ||
            (tier === "rare" && bootstrap.data.entitlements.free_rare_box > 0));
        const price = draw_count === 10 ? box.ten_price : box.single_price;
        const balance = identity.assets.kcoin.available;
        const estimatedGap = free || balance >= price ? null : price - balance;
        remove(operation.id);
        navigate(`/?tier=${tier}`);
        if (estimatedGap !== null)
          requestTopup({ kind: "gacha", tier, draw_count }, estimatedGap);
        else
          await run(
            draw_count === 10 ? "正在准备十连开盒" : "正在开启盲盒",
            "gacha.open",
            { tier, draw_count },
          );
      } catch {
        if (!isCurrentNormalSession(generation)) return;
        setGachaActionError({
          operationId: operation.id,
          message: "最新开盒状态加载失败，请重试",
        });
      } finally {
        setGachaActionId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [gachaActionId, navigate, remove, requestTopup, run],
  );

  const acknowledgeEvolutionResult = useCallback(
    async (operation: RegisteredOperation, action: EvolutionResultAction) => {
      if (
        operation.routeId !== "inventory.evolve" ||
        !["succeeded", "failed"].includes(operation.phase) ||
        acknowledgingId
      )
        return;
      const generation = operation.sessionGeneration;
      const parsed = routeById("inventory.evolve").output.safeParse(
        operation.result,
      );
      if (
        action !== "acknowledge" &&
        (!parsed.success || parsed.data.success_count < 1)
      ) {
        setAcknowledgementError({
          operationId: operation.id,
          message: "进化结果详情暂时无法确认，请查询原操作",
        });
        return;
      }
      setAcknowledgingId(operation.id);
      setAcknowledgementError(null);
      const localSettlementRefreshSucceeded =
        locallyRefreshedEvolutionIds.current.has(operation.id);
      let confirmationComplete = !operation.persistent;
      try {
        if (!operation.persistent) {
          if (!localSettlementRefreshSucceeded)
            await refreshRouteScopes("inventory.evolve", {
              throwOnError: true,
            });
          remove(operation.id);
          return;
        }
        await apiRequest("inventory.acknowledge_evolution_result", {
          operation_id: operation.id,
        });
        if (!isCurrentNormalSession(generation)) return;
        confirmationComplete = true;
        if (!localSettlementRefreshSucceeded)
          await refreshRouteScopes("inventory.evolve", {
            throwOnError: true,
          });
        if (!isCurrentNormalSession(generation)) return;
        acknowledgedIds.current.add(operation.id);
        remove(operation.id);
        if (
          action === "inventory" &&
          parsed.success &&
          parsed.data.success_count > 0
        )
          navigate(
            `/inventory?template=${encodeURIComponent(parsed.data.target.template_id)}&view=details`,
          );
        else if (action === "album") navigate("/album");
      } catch {
        if (!isCurrentNormalSession(generation)) return;
        setAcknowledgementError({
          operationId: operation.id,
          message: confirmationComplete
            ? "藏品状态更新失败，请重试"
            : "结果确认状态保存失败，请重试",
        });
      } finally {
        setAcknowledgingId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [acknowledgingId, navigate, remove],
  );

  const defer = useCallback(() => {
    if (!active) return;
    if (invalidGachaSuccess)
      update(active.id, {
        phase: "unknown",
        message: "开盒结果详情暂时无法确认，请查询原操作",
      });
    if (invalidWheelSuccess)
      update(active.id, {
        phase: "unknown",
        message: "转盘结果详情暂时无法确认，请查询原操作",
      });
    if (invalidAlbumClaimSuccess)
      update(active.id, {
        phase: "unknown",
        message: "图鉴奖励详情暂时无法确认，请查询原操作",
      });
    setActiveId(null);
  }, [
    active,
    invalidAlbumClaimSuccess,
    invalidGachaSuccess,
    invalidWheelSuccess,
    update,
  ]);

  const trapDialogFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!controls.length) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <OperationRegistryContext.Provider value={value}>
      {children}
      {session?.accountStatus === "normal" &&
        !active &&
        resumableUnresolved.length > 0 && (
          <button
            className="operation-resume"
            onClick={() => setActiveId(resumableUnresolved[0]?.id ?? null)}
          >
            {resumableUnresolved.length} 个操作待确认
          </button>
        )}
      {active && showOperationDialog && (
        <div
          ref={dialogRef}
          className={`modal-backdrop operation-dialog-backdrop ${
            active.routeId === "gacha.open"
              ? `gacha-operation-backdrop phase-${active.phase}${showGachaAnimation ? " gacha-hatching-backdrop" : gachaResult ? " gacha-result-backdrop" : ""}`
              : active.routeId === "inventory.decompose"
                ? `decomposition-operation-backdrop phase-${active.phase}`
                : active.routeId === "inventory.evolve"
                  ? `evolution-operation-backdrop phase-${active.phase}`
                  : active.routeId === "market.create_listing" &&
                      active.phase === "succeeded"
                    ? "app-shell result-sheet-backdrop market-listing-success-backdrop"
                    : active.routeId === "market.create_listing" &&
                        active.phase === "failed"
                      ? "app-shell market-listing-failure-backdrop"
                      : active.routeId === "market.purchase" &&
                          active.phase === "succeeded" &&
                          marketPurchaseResult
                        ? "app-shell result-sheet-backdrop market-listing-success-backdrop market-purchase-success-backdrop"
                        : active.routeId === "market.purchase"
                          ? "app-shell market-listing-failure-backdrop market-purchase-failure-backdrop"
                          : wheelResult
                            ? "app-shell result-sheet-backdrop wheel-result-backdrop"
                            : ""
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={showGachaAnimation ? "月下灵契仪式" : undefined}
          aria-labelledby={
            showGachaAnimation
              ? undefined
              : active.routeId === "market.create_listing"
                ? active.phase === "succeeded"
                  ? "market-listing-success-title"
                  : "market-listing-failure-title"
                : active.routeId === "market.purchase"
                  ? active.phase === "succeeded" && marketPurchaseResult
                    ? "market-purchase-success-title"
                    : "market-purchase-failure-title"
                  : active.routeId === "inventory.decompose"
                    ? "decomposition-result-title"
                    : active.routeId === "inventory.evolve"
                      ? "evolution-result-title"
                      : gachaResult
                        ? "gacha-result-title"
                        : wheelResult
                          ? "wheel-result-title"
                          : albumClaimResult
                            ? "album-claim-result-title"
                            : "operation-dialog-title"
          }
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
        >
          {active.routeId === "market.create_listing" &&
          active.phase === "succeeded" ? (
            <MarketListingSuccessDialog onConfirm={dismiss} />
          ) : active.routeId === "market.create_listing" &&
            active.phase === "failed" ? (
            <MarketListingFailureDialog
              message={marketListingFailureMessage(active.errorCode)}
              onConfirm={dismiss}
            />
          ) : active.routeId === "market.purchase" &&
            active.phase === "succeeded" ? (
            marketPurchaseResult ? (
              <MarketPurchaseSuccessDialog
                name={marketPurchaseResult.name}
                quantity={marketPurchaseResult.result.quantity}
                onConfirm={dismiss}
              />
            ) : (
              <MarketPurchaseFailureDialog
                message="购买状态已更新，请查看最新藏品和余额。"
                onConfirm={dismiss}
              />
            )
          ) : active.routeId === "market.purchase" &&
            active.phase === "failed" ? (
            <MarketPurchaseFailureDialog
              message={marketPurchaseFailureMessage(active.errorCode)}
              onConfirm={dismiss}
            />
          ) : active.routeId === "inventory.decompose" ? (
            <DecompositionOperationDialog
              key={active.id}
              operationId={active.id}
              phase={active.phase}
              result={active.result}
              errorCode={active.errorCode}
              presentation={active.presentation}
              onRecover={() => void recover(active)}
              onCollect={dismiss}
            />
          ) : active.routeId === "inventory.evolve" ? (
            <EvolutionOperationDialog
              key={active.id}
              operationId={active.id}
              phase={active.phase}
              input={active.input}
              result={active.result}
              errorCode={active.errorCode}
              busy={acknowledgingId === active.id}
              actionError={
                acknowledgementError?.operationId === active.id
                  ? acknowledgementError.message
                  : null
              }
              onRecover={() => void recover(active)}
              onSuccess={(action) =>
                void acknowledgeEvolutionResult(active, action)
              }
              onAcknowledge={() =>
                void acknowledgeEvolutionResult(active, "acknowledge")
              }
            />
          ) : showGachaAnimation ? (
            <GachaHatchAnimation
              tier={
                active.animationTier ??
                gachaAnimationTier(active.input, gachaResult)
              }
            />
          ) : gachaResult ? (
            <GachaResultDialog
              result={gachaResult}
              busy={gachaActionId === active.id}
              error={
                gachaActionError?.operationId === active.id
                  ? gachaActionError.message
                  : null
              }
              onRepeat={() => void repeatGacha(active)}
              onInventory={() => {
                remove(active.id);
                navigate("/inventory");
              }}
              onConfirm={() => remove(active.id)}
            />
          ) : wheelResult ? (
            <WheelResultDialog
              result={wheelResult}
              onConfirm={() => remove(active.id)}
            />
          ) : albumClaimResult ? (
            <AlbumClaimResultDialog
              operationId={active.id}
              result={albumClaimResult}
              onConfirm={dismiss}
            />
          ) : (
            <div
              className={`modal ${
                active.routeId === "gacha.open"
                  ? `gacha-operation-modal phase-${active.phase}`
                  : ""
              }`}
            >
              <div
                className={`operation-mark ${invalidDedicatedSuccess ? "unknown" : active.phase}`}
              >
                {invalidDedicatedSuccess
                  ? "…"
                  : active.phase === "succeeded"
                    ? "✓"
                    : active.phase === "failed"
                      ? "!"
                      : "…"}
              </div>
              <h2 id="operation-dialog-title">
                {operationDialogTitle(active)}
              </h2>
              <p>
                {invalidGachaSuccess
                  ? "开盒结果详情暂时无法确认，请查询原操作"
                  : invalidWheelSuccess
                    ? "转盘结果详情暂时无法确认，请查询原操作"
                    : invalidAlbumClaimSuccess
                      ? "图鉴奖励详情暂时无法确认，请查询原操作"
                      : active.message}
              </p>
              <code>操作号 {active.id}</code>
              {serverAcknowledgementRouteIds.has(active.routeId) &&
              acknowledgementError?.operationId === active.id ? (
                <p className="operation-ack-error">
                  {acknowledgementError.message}
                </p>
              ) : null}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button onClick={() => void recover(active)}>查询原操作</Button>
              )}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button className="secondary" onClick={defer}>
                  稍后处理
                </Button>
              )}
              {!invalidDedicatedSuccess &&
                !serverAcknowledgementRouteIds.has(active.routeId) &&
                active.routeId !== "gacha.open" &&
                active.routeId !== "wheel.spin" &&
                (active.phase === "succeeded" || active.phase === "failed") && (
                  <Button className="secondary" onClick={dismiss}>
                    完成
                  </Button>
                )}
              {active.routeId === "gacha.open" && active.phase === "failed" ? (
                <Button className="secondary" onClick={dismiss}>
                  确定
                </Button>
              ) : null}
              {active.routeId === "wheel.spin" && active.phase === "failed" ? (
                <Button className="secondary" onClick={() => remove(active.id)}>
                  确定
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </OperationRegistryContext.Provider>
  );
}

function isCurrentNormalSession(generation: string): boolean {
  const session = getSession();
  return (
    session?.generation === generation && session.accountStatus === "normal"
  );
}

function gachaAnimationTier(
  input: unknown,
  result: GachaResult | null,
): GachaHatchTier {
  if (result) return result.tier;
  if (input && typeof input === "object" && "tier" in input) {
    const tier = input.tier;
    if (tier === "normal" || tier === "rare" || tier === "legendary")
      return tier;
  }
  return "normal";
}

function recoveredMessage(operation: RecoverableOperationSummary): string {
  if (operation.status === "succeeded")
    return confirmedMessage(operation.use_case, operation.result);
  if (operation.status === "failed")
    return operation.error_code && isErrorCode(operation.error_code)
      ? errorDefinition(operation.error_code).message
      : "原操作已确认失败";
  return operation.status === "unknown"
    ? "原操作结果未知，需要继续查询"
    : "原操作仍在处理中";
}

function operationDialogTitle(operation: RegisteredOperation): string {
  if (operation.phase === "succeeded") {
    if (operation.routeId === "market.cancel_template_listings")
      return "已下架";
  }
  return operation.routeId === "gacha.open" && operation.phase === "failed"
    ? "开盒失败"
    : operation.label;
}

function confirmedMessage(
  routeId: RecoverableRouteId,
  result: unknown,
): string {
  if (routeId === "market.create_listing") return "藏品已成功上架";
  if (routeId === "market.purchase") return "购买成功";
  if (routeId !== "market.cancel_template_listings")
    return "结果已由服务器确认";
  const parsed = routeById(routeId).output.safeParse(result);
  if (!parsed.success) return "已下架，真实状态已刷新";
  return parsed.data.released_quantity > 0
    ? `已下架，已释放 ${parsed.data.released_quantity} 个未成交藏品`
    : "已下架，当前没有有效挂单";
}

function marketListingFailureMessage(errorCode: string | null): string {
  if (
    errorCode &&
    playerFacingMarketListingErrorCodes.has(errorCode) &&
    isErrorCode(errorCode)
  )
    return errorDefinition(errorCode).message;
  return "藏品没有上架，请根据最新的可出售状态重试。";
}

function marketPurchaseFailureMessage(errorCode: string | null): string {
  if (
    errorCode &&
    playerFacingMarketPurchaseErrorCodes.has(errorCode) &&
    isErrorCode(errorCode)
  )
    return errorDefinition(errorCode).message;
  return "本次购买没有完成，请根据最新库存和余额重试。";
}

function refreshingAuthorityMessage(routeId: RecoverableRouteId): string {
  return routeId === "market.purchase"
    ? "购买已完成，正在更新藏品和余额"
    : "上架已确认，正在更新出售状态";
}

function syncingAuthorityMessage(routeId: RecoverableRouteId): string {
  return routeId === "market.purchase"
    ? "购买状态正在同步"
    : "上架状态正在同步";
}
