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
  isRecoverableRouteId,
  loadClientRoute,
  parseEvolutionRejectedResult,
  type RecoverableOperationSummary,
  type RecoverableRouteId,
  type RouteInput,
  type RouteOutput,
} from "@evomypet/api-contracts/app-client";
import { parseRecoveredOperation } from "@evomypet/api-contracts/app-client/recovery";
import {
  errorDefinition,
  isErrorCode,
} from "@evomypet/api-contracts/app-client/errors";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import { prepareGachaRitualAudio } from "../../platform/audio/gachaRitualAudio.ts";
import { useAppNavigate } from "../../platform/navigation/index.tsx";
import { isLowPowerAnimationDevice } from "../../platform/runtime/devicePerformance.ts";
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
import { usePageModulePreparation } from "../../shared/navigation/pageModulePreparation.ts";
import { Button } from "../../shared/ui/Button.tsx";
import { useNewMarkers } from "../new-markers/context.ts";
import { useNavigationIntent } from "../payment-recovery/context.ts";
import {
  type GachaHatchTier,
  type OperationPhase,
  type OperationPresentation,
  type OperationRegistryCommands,
  type OperationRegistryRuntimeHost,
  type OperationRuntimeController,
  type OperationRuntimeSignals,
} from "./context.ts";
import { operationLabel } from "./labels.ts";
import { markOperationNewTemplates } from "./operation-new-markers.ts";
import {
  preloadOperationPresentation,
  type LoadedOperationPresentation,
} from "./presentation-loader.ts";
import { t, tp } from "../../platform/i18n/index.ts";

type RegisteredOperation = {
  id: string;
  sessionGeneration: string;
  routeId: RecoverableRouteId;
  label: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
  presentationStatus: "ready" | "unavailable";
  autoRecoveryExhausted: boolean;
  persistent: boolean;
  input: unknown;
  presentation: OperationPresentation | null;
  animationTier: GachaHatchTier | null;
  terminalPresentationAllowed: boolean;
};

type EvolutionResultAction = "inventory" | "album" | "acknowledge";
type GachaImagePreparationStatus = "loading" | "ready" | "failed";
type GachaImagePreparationState = {
  operationId: string;
  status: GachaImagePreparationStatus;
  retryEpoch: number;
  hasFailed: boolean;
};
type GachaResult = RouteOutput<"gacha.open">;
type WheelResult = RouteOutput<"wheel.spin">;
type AlbumClaimResult = RouteOutput<"album.claim">;
type VipClaimResult =
  | RouteOutput<"vip.claim_fgems">
  | RouteOutput<"vip.claim_free_box">;
type DecompositionResult = RouteOutput<"inventory.decompose">;
type EvolutionResult = RouteOutput<"inventory.evolve">;
type EvolutionInput = RouteInput<"inventory.evolve">;
type MarketPurchasePresentationResult = {
  name: string;
  result: RouteOutput<"market.purchase">;
};
type ValidatedDedicatedOperation =
  | { id: string; routeId: "gacha.open"; result: GachaResult | null }
  | { id: string; routeId: "wheel.spin"; result: WheelResult | null }
  | { id: string; routeId: "album.claim"; result: AlbumClaimResult | null }
  | {
      id: string;
      routeId: "vip.claim_fgems" | "vip.claim_free_box";
      result: VipClaimResult | null;
    }
  | {
      id: string;
      routeId: "market.purchase";
      input: RouteInput<"market.purchase"> | null;
      result: RouteOutput<"market.purchase"> | null;
    }
  | {
      id: string;
      routeId: "inventory.decompose";
      result: DecompositionResult | null;
    }
  | {
      id: string;
      routeId: "inventory.evolve";
      input: EvolutionInput | null;
      result: EvolutionResult | null;
      rejectedResult: Awaited<
        ReturnType<typeof parseEvolutionRejectedResult>
      > | null;
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
  "vip.claim_fgems",
  "vip.claim_free_box",
  "wheel.spin",
]);
const GACHA_RESULT_PREPARATION_DELAY_MS = 1_840;
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
  "referral.bind",
  "topup.cancel_order",
  "topup.create_order",
  "topup.fail_order",
  "vip.cancel_order",
  "vip.create_order",
]);
const playerFacingMarketListingErrorCodes = new Set([
  "ACCOUNT_RESTRICTED",
  "INSUFFICIENT_INVENTORY",
  "MARKET_ACTIVE_TEMPLATE_LIMIT",
  "MARKET_DAILY_LISTING_LIMIT",
  "MARKET_LIFETIME_LISTING_LIMIT",
  "TEMPLATE_NOT_FOUND",
]);
const playerFacingMarketPurchaseErrorCodes = new Set([
  "INSUFFICIENT_BALANCE",
  "MARKET_STOCK_INSUFFICIENT",
  "TEMPLATE_NOT_FOUND",
]);

export function OperationRegistryRuntimeProvider({
  host,
}: {
  host: OperationRegistryRuntimeHost;
}): ReactNode {
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
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
  const [gachaTensionReadyId, setGachaTensionReadyId] = useState<string | null>(
    null,
  );
  const [gachaResultPreparationReadyId, setGachaResultPreparationReadyId] =
    useState<string | null>(null);
  const [revealingGachaAnimationId, setRevealingGachaAnimationId] = useState<
    string | null
  >(null);
  const [gachaImagePreparation, setGachaImagePreparation] =
    useState<GachaImagePreparationState | null>(null);
  const [wheelPresentationEpoch, setWheelPresentationEpoch] = useState(0);
  const [hydrationEpoch, setHydrationEpoch] = useState(0);
  const hydrationEpochRef = useRef(0);
  const [presentationState, setPresentationState] = useState<{
    operationId: string;
    loaded: LoadedOperationPresentation | null;
    failed: boolean;
  } | null>(null);
  const [validationState, setValidationState] = useState<{
    source: RegisteredOperation;
    validated: ValidatedDedicatedOperation | null;
  } | null>(null);
  const [mountedGachaAnimationId, setMountedGachaAnimationId] = useState<
    string | null
  >(null);
  const recoveringIds = useRef(new Set<string>());
  const acknowledgedIds = useRef(new Set<string>());
  const locallyRefreshedEvolutionIds = useRef(new Set<string>());
  const needsAuthorityRefreshAfterLeave = useRef(new Set<RecoverableRouteId>());
  const active = activeId ? operations[activeId] : undefined;
  const activePresentationId = active?.id;
  const activePresentationRouteId = active?.routeId;
  const activePresentationState =
    presentationState?.operationId === active?.id ? presentationState : null;
  const loadedPresentation =
    activePresentationState?.loaded ??
    (active &&
    presentationState?.loaded &&
    presentationMatchesRoute(presentationState.loaded, active.routeId)
      ? presentationState.loaded
      : null);
  const presentationLoadFailed = activePresentationState?.failed ?? false;
  const validatedOperation =
    validationState && validationState.source === active
      ? validationState.validated
      : null;
  const validationPending = Boolean(
    active &&
    requiresDedicatedValidation(active.routeId) &&
    validationState?.source !== active,
  );
  const operationSignals = useMemo(() => {
    const blockedRoutes = new Set<RecoverableRouteId>();
    let navigationLocked = false;
    let recoveryQueueActive = false;
    for (const operation of Object.values(operations)) {
      if (operation.sessionGeneration !== session?.generation) continue;
      if (
        unresolvedPhases.has(operation.phase) ||
        navigationLockedThroughResultRouteIds.has(operation.routeId)
      )
        blockedRoutes.add(operation.routeId);
      if (
        navigationLockedThroughResultRouteIds.has(operation.routeId) ||
        (operation.routeId === "inventory.evolve" &&
          unresolvedPhases.has(operation.phase))
      )
        navigationLocked = true;
      if (
        serverAcknowledgementRouteIds.has(operation.routeId) ||
        (operation.routeId === "wheel.spin" &&
          unresolvedPhases.has(operation.phase))
      )
        recoveryQueueActive = true;
    }
    return { blockedRoutes, navigationLocked, recoveryQueueActive };
  }, [operations, session?.generation]);
  const runtimeSignals = useMemo<OperationRuntimeSignals>(
    () => ({
      ...operationSignals,
      wheelPresentationEpoch,
      hydrationEpoch,
    }),
    [hydrationEpoch, operationSignals, wheelPresentationEpoch],
  );
  const validatedActive = validatedOperation;
  const gachaResult =
    validatedActive?.routeId === "gacha.open" ? validatedActive.result : null;
  const wheelResult =
    validatedActive?.routeId === "wheel.spin" ? validatedActive.result : null;
  const albumClaimResult =
    validatedActive?.routeId === "album.claim" ? validatedActive.result : null;
  const vipClaimResult =
    validatedActive?.routeId === "vip.claim_fgems" ||
    validatedActive?.routeId === "vip.claim_free_box"
      ? validatedActive.result
      : null;
  const decompositionResult =
    validatedActive?.routeId === "inventory.decompose"
      ? validatedActive.result
      : null;
  const evolutionInput =
    validatedActive?.routeId === "inventory.evolve"
      ? validatedActive.input
      : null;
  const evolutionResult =
    validatedActive?.routeId === "inventory.evolve"
      ? validatedActive.result
      : null;
  const evolutionRejectedResult =
    validatedActive?.routeId === "inventory.evolve"
      ? validatedActive.rejectedResult
      : null;
  const marketPurchaseResult =
    useMemo<MarketPurchasePresentationResult | null>(() => {
      if (active?.routeId !== "market.purchase" || active.phase !== "succeeded")
        return null;
      const validated =
        validatedActive?.routeId === "market.purchase" ? validatedActive : null;
      if (
        !validated?.input ||
        !validated.result ||
        validated.result.template_id !== validated.input.template_id ||
        !active.presentation?.name
      )
        return null;
      return { name: active.presentation.name, result: validated.result };
    }, [active, validatedActive]);
  const invalidGachaSuccess = Boolean(
    active?.routeId === "gacha.open" &&
    active.phase === "succeeded" &&
    active.presentationStatus !== "unavailable" &&
    !validationPending &&
    !gachaResult,
  );
  const invalidWheelSuccess = Boolean(
    active?.routeId === "wheel.spin" &&
    active.phase === "succeeded" &&
    !validationPending &&
    !wheelResult,
  );
  const invalidAlbumClaimSuccess = Boolean(
    active?.routeId === "album.claim" &&
    active.phase === "succeeded" &&
    !validationPending &&
    !albumClaimResult,
  );
  const invalidVipClaimSuccess = Boolean(
    (active?.routeId === "vip.claim_fgems" ||
      active?.routeId === "vip.claim_free_box") &&
    active.phase === "succeeded" &&
    !validationPending &&
    !vipClaimResult,
  );
  const invalidDedicatedSuccess =
    invalidGachaSuccess ||
    invalidWheelSuccess ||
    invalidAlbumClaimSuccess ||
    invalidVipClaimSuccess;
  const unresolved = Object.values(operations).filter((operation) =>
    unresolvedPhases.has(operation.phase),
  );
  const resumableUnresolved = unresolved.filter(
    (operation) =>
      operation.routeId !== "market.create_listing" &&
      operation.routeId !== "market.purchase",
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
  const gachaResultPreparationReady =
    animatedGachaOperationId === null ||
    gachaResultPreparationReadyId === animatedGachaOperationId;
  const gachaResultStageReady =
    animatedGachaOperationId === null ||
    gachaTensionReadyId === animatedGachaOperationId;
  const activeGachaImagePreparation =
    gachaImagePreparation?.operationId === active?.id
      ? gachaImagePreparation
      : null;
  const gachaImagesReady = activeGachaImagePreparation?.status === "ready";
  const gachaImageRetryEpoch = activeGachaImagePreparation?.retryEpoch ?? 0;
  const gachaImageHasFailed = activeGachaImagePreparation?.hasFailed === true;
  const gachaPresentationUnavailable = Boolean(
    active?.routeId === "gacha.open" &&
    active.presentationStatus === "unavailable",
  );
  const gachaRecoveryPaused = Boolean(
    active?.routeId === "gacha.open" &&
    unresolvedPhases.has(active.phase) &&
    active.autoRecoveryExhausted,
  );
  const gachaRevealRarity =
    gachaResult && gachaImagesReady
      ? highestGachaResultRarity(gachaResult)
      : null;
  const gachaIsRevealing =
    animatedGachaOperationId !== null &&
    revealingGachaAnimationId === animatedGachaOperationId &&
    !gachaPresentationReady;
  const showGachaImageUnavailable = Boolean(
    active?.routeId === "gacha.open" &&
    gachaResult &&
    gachaPresentationReady &&
    gachaImageHasFailed &&
    !gachaImagesReady,
  );
  const showGachaAnimation = Boolean(
    active?.routeId === "gacha.open" &&
    !gachaPresentationUnavailable &&
    !gachaRecoveryPaused &&
    (!gachaPresentationReady ||
      unresolvedPhases.has(active.phase) ||
      (gachaResult && !gachaImagesReady && !gachaImageHasFailed)),
  );
  const gachaResultVisible = Boolean(
    gachaResult && gachaPresentationReady && gachaImagesReady,
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

  const loadPresentation = useCallback(
    (operationId: string, routeId: RecoverableRouteId) => {
      return preloadOperationPresentation(routeId)
        .then((loaded) => {
          setPresentationState({ operationId, loaded, failed: false });
          return loaded;
        })
        .catch(() => {
          setPresentationState({ operationId, loaded: null, failed: true });
          return null;
        });
    },
    [],
  );

  useEffect(() => {
    if (
      activePresentationId &&
      activePresentationRouteId &&
      hasDedicatedPresentation(activePresentationRouteId)
    )
      void loadPresentation(activePresentationId, activePresentationRouteId);
  }, [activePresentationId, activePresentationRouteId, loadPresentation]);

  useEffect(() => {
    if (!active || !requiresDedicatedValidation(active.routeId)) return;
    const operation = active;
    let cancelled = false;
    void validateDedicatedOperation(operation)
      .then((validated) => {
        if (!cancelled) setValidationState({ source: operation, validated });
      })
      .catch(() => {
        if (!cancelled)
          setValidationState({ source: operation, validated: null });
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

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
        setGachaTensionReadyId(null);
        setGachaResultPreparationReadyId(null);
        setRevealingGachaAnimationId(null);
        setGachaImagePreparation(null);
        setMountedGachaAnimationId(null);
        setPresentationState(null);
        setValidationState(null);
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
    if (
      !animatedGachaOperationId ||
      mountedGachaAnimationId !== animatedGachaOperationId
    )
      return;
    const operationId = animatedGachaOperationId;
    const timer = window.setTimeout(
      () => setGachaResultPreparationReadyId(operationId),
      GACHA_RESULT_PREPARATION_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [animatedGachaOperationId, mountedGachaAnimationId]);

  useEffect(() => {
    if (
      !animatedGachaOperationId ||
      mountedGachaAnimationId !== animatedGachaOperationId
    )
      return;
    const operationId = animatedGachaOperationId;
    const timer = window.setTimeout(
      () => setGachaTensionReadyId(operationId),
      4_000,
    );
    return () => window.clearTimeout(timer);
  }, [animatedGachaOperationId, mountedGachaAnimationId]);

  useEffect(() => {
    if (
      !animatedGachaOperationId ||
      gachaTensionReadyId !== animatedGachaOperationId ||
      revealingGachaAnimationId === animatedGachaOperationId ||
      revealedGachaAnimationId === animatedGachaOperationId ||
      active?.id !== animatedGachaOperationId
    )
      return;
    const outcomeReady =
      active.phase === "failed" ||
      (active.phase === "succeeded" &&
        Boolean(gachaResult) &&
        (gachaImagesReady || gachaImageHasFailed));
    if (!outcomeReady) return;
    const operationId = animatedGachaOperationId;
    const timer = window.setTimeout(
      () => setRevealingGachaAnimationId(operationId),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [
    active,
    animatedGachaOperationId,
    gachaImageHasFailed,
    gachaImagesReady,
    gachaResult,
    gachaTensionReadyId,
    revealedGachaAnimationId,
    revealingGachaAnimationId,
  ]);

  useEffect(() => {
    if (
      !animatedGachaOperationId ||
      revealingGachaAnimationId !== animatedGachaOperationId
    )
      return;
    const operationId = animatedGachaOperationId;
    const timer = window.setTimeout(
      () => setRevealedGachaAnimationId(operationId),
      700,
    );
    return () => window.clearTimeout(timer);
  }, [animatedGachaOperationId, revealingGachaAnimationId]);

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
    setGachaImagePreparation((current) =>
      current?.operationId === id ? null : current,
    );
    setGachaTensionReadyId((current) => (current === id ? null : current));
    setRevealingGachaAnimationId((current) =>
      current === id ? null : current,
    );
    setRevealedGachaAnimationId((current) => (current === id ? null : current));
    setMountedGachaAnimationId((current) => (current === id ? null : current));
  }, []);

  const refreshAuthorityAfterLeave = useCallback(() => {
    const routeIds = [...needsAuthorityRefreshAfterLeave.current];
    if (routeIds.length === 0) return;
    needsAuthorityRefreshAfterLeave.current.clear();
    void Promise.all(routeIds.map((routeId) => loadClientRoute(routeId)))
      .then((routes) =>
        refreshScopes(
          [...new Set(routes.flatMap((route) => route.refreshScopes ?? []))],
          { throwOnError: true },
        ),
      )
      .catch(() => {
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
    setGachaTensionReadyId((id) =>
      id && discardedGachaIds.has(id) ? null : id,
    );
    setRevealingGachaAnimationId((id) =>
      id && discardedGachaIds.has(id) ? null : id,
    );
    setGachaImagePreparation((current) =>
      current && discardedGachaIds.has(current.operationId) ? null : current,
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

  const run: OperationRegistryCommands["run"] = useCallback(
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
      if (!options?.background)
        void preloadOperationPresentation(routeId).catch(() => undefined);
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
          message: t("正在确认本次操作"),
          result: null,
          errorCode: null,
          presentationStatus: "ready",
          autoRecoveryExhausted: false,
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
        message: t("操作处理中，请勿重复操作"),
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
              ? t("结果仍在确认，请勿重复操作")
              : confirmedMessage(routeId, response.data),
            result: response.data,
            presentationStatus: "ready",
            autoRecoveryExhausted: false,
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
          routeId !== "inventory.decompose" &&
          !(routeId === "gacha.open" && isLowPowerAnimationDevice())
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
                t("操作结果暂时无法确认"),
                true,
                id,
              );
        if (routeId === "inventory.evolve" && failure.code === "ACK_REQUIRED") {
          remove(id);
          return null;
        }
        const unknown =
          Boolean(failure.operationId) &&
          ([
            "NETWORK_ERROR",
            "OPERATION_RESULT_INVALID",
            "RESPONSE_INVALID",
            "CATALOG_UNAVAILABLE",
          ].includes(failure.code) ||
            !(cause instanceof ApiFailure));
        if (options?.dialog === false && !options.retainOnFailure && !unknown)
          remove(id);
        else
          update(id, {
            phase: unknown ? "unknown" : "failed",
            message: unknown
              ? failure.code === "NETWORK_ERROR"
                ? t("网络中断，结果仍在确认，请勿重复操作")
                : t("结果详情暂时无法确认，请勿重复操作")
              : failure.message,
            errorCode: failure.code,
            autoRecoveryExhausted: false,
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
    void preloadOperationPresentation(routeId).catch(() => undefined);
    setActiveId(operation.id);
    return true;
  }, []);

  const preload = useCallback((routeId: RecoverableRouteId): void => {
    void preloadOperationPresentation(routeId).catch(() => undefined);
  }, []);

  const hydrate = useCallback(
    (incoming: readonly RecoverableOperationSummary[]) => {
      const nextHydrationEpoch = hydrationEpochRef.current + 1;
      hydrationEpochRef.current = nextHydrationEpoch;
      setHydrationEpoch(nextHydrationEpoch);
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return nextHydrationEpoch;
      const next = { ...operationsRef.current };
      const completedOutsideRegistry = new Set<string>();
      let firstId: string | null = null;
      for (const operation of incoming) {
        void preloadOperationPresentation(operation.use_case).catch(
          () => undefined,
        );
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
          presentationStatus:
            operation.status === "succeeded" &&
            operation.error_code === "CATALOG_UNAVAILABLE"
              ? "unavailable"
              : "ready",
          autoRecoveryExhausted: false,
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
      return nextHydrationEpoch;
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
      update(operation.id, {
        phase: "pending",
        message: t("正在确认最新结果"),
      });
      try {
        const response = await apiRequest("operations.get", {
          operation_id: operation.id,
        });
        if (operation.sessionGeneration !== getSession()?.generation) return;
        const recovered = await parseRecoveredOperation(response.data);
        if (recovered.acknowledged_at !== null) {
          remove(operation.id);
          return;
        }
        if (recovered.status === "succeeded") {
          if (
            operation.routeId === "gacha.open" &&
            recovered.error_code === "CATALOG_UNAVAILABLE" &&
            recovered.result === null
          ) {
            update(operation.id, {
              phase: "succeeded",
              message: t("奖励已存入藏品"),
              result: null,
              errorCode: null,
              presentationStatus: "unavailable",
              autoRecoveryExhausted: false,
              persistent: true,
            });
            await refreshRouteScopes(operation.routeId).catch(() => undefined);
            return;
          }
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
              presentationStatus: "ready",
              autoRecoveryExhausted: false,
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
            operation.routeId !== "inventory.decompose" &&
            !(operation.routeId === "gacha.open" && isLowPowerAnimationDevice())
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
            message: definition?.message ?? t("操作未完成"),
            result: recovered.result,
            errorCode: recovered.error_code,
            presentationStatus: "ready",
            autoRecoveryExhausted: false,
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
                ? t("结果仍在确认，请稍后查看")
                : t("操作仍在处理中，请勿重复操作"),
            presentationStatus: "ready",
          });
        }
      } catch (cause) {
        update(operation.id, {
          phase: "unknown",
          message:
            cause instanceof ApiFailure
              ? cause.message
              : t("暂时无法确认最新结果"),
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
    !active.autoRecoveryExhausted &&
    ["pending", "unknown"].includes(active.phase)
      ? active.id
      : (Object.values(operations).find(
          (operation) =>
            autoPollingRouteIds.has(operation.routeId) &&
            !operation.autoRecoveryExhausted &&
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
      const delay = delays[attempt];
      if (delay === undefined) return;
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
        const recovered = operationsRef.current[operationId];
        if (
          !cancelled &&
          recovered &&
          ["pending", "unknown"].includes(recovered.phase) &&
          attempt >= delays.length
        ) {
          update(operationId, {
            autoRecoveryExhausted: true,
            message: t("结果仍在确认，请稍后查看"),
          });
          return;
        }
        poll();
      }, delay);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollingOperationId, recover, update]);

  const controller = useMemo<OperationRuntimeController>(
    () => ({
      run,
      present,
      preload,
      hydrate,
    }),
    [hydrate, preload, present, run],
  );
  useLayoutEffect(() => host.attachRuntime(controller), [controller, host]);
  useLayoutEffect(
    () => host.publishRuntimeSignals(controller, runtimeSignals),
    [controller, host, runtimeSignals],
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
      prepareGachaRitualAudio();
      const generation = operation.sessionGeneration;
      const route = await loadClientRoute("gacha.open");
      const parsedResult = route.output.safeParse(operation.result);
      if (!parsedResult.success) {
        setGachaActionError({
          operationId: operation.id,
          message: t("开盒结果详情暂时无法读取"),
        });
        return;
      }
      setGachaActionId(operation.id);
      setGachaActionError(null);
      try {
        const [bootstrap, identity] = await Promise.all([
          apiRequest("gacha.bootstrap", {}),
          fetchApiQuery("identity.summary"),
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
            message: t("开盒规则加载失败，请重试"),
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
        const path = `/?tier=${tier}`;
        preparePage(path);
        navigate(path);
        if (estimatedGap !== null)
          requestTopup({ kind: "gacha", tier, draw_count }, estimatedGap);
        else
          await run(
            draw_count === 10 ? t("正在准备十连开盒") : t("正在开启盲盒"),
            "gacha.open",
            { tier, draw_count },
          );
      } catch {
        if (!isCurrentNormalSession(generation)) return;
        setGachaActionError({
          operationId: operation.id,
          message: t("最新开盒状态加载失败，请重试"),
        });
      } finally {
        setGachaActionId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [gachaActionId, navigate, preparePage, remove, requestTopup, run],
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
      const route = await loadClientRoute("inventory.evolve");
      const parsed = route.output.safeParse(operation.result);
      if (
        action !== "acknowledge" &&
        (!parsed.success || parsed.data.success_count < 1)
      ) {
        setAcknowledgementError({
          operationId: operation.id,
          message: t("进化结果详情暂时无法确认，请查看最新结果"),
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
        ) {
          const path = `/inventory?template=${encodeURIComponent(parsed.data.target.template_id)}&view=details`;
          preparePage(path);
          navigate(path);
        } else if (action === "album") {
          preparePage("/album");
          navigate("/album");
        }
      } catch {
        if (!isCurrentNormalSession(generation)) return;
        setAcknowledgementError({
          operationId: operation.id,
          message: confirmationComplete
            ? t("藏品状态更新失败，请重试")
            : t("结果确认状态保存失败，请重试"),
        });
      } finally {
        setAcknowledgingId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [acknowledgingId, navigate, preparePage, remove],
  );

  const defer = useCallback(() => {
    if (!active) return;
    if (invalidGachaSuccess)
      update(active.id, {
        phase: "unknown",
        message: t("开盒结果详情暂时无法确认，请查看最新结果"),
      });
    if (invalidWheelSuccess)
      update(active.id, {
        phase: "unknown",
        message: t("转盘结果详情暂时无法确认，请查看最新结果"),
      });
    if (invalidAlbumClaimSuccess)
      update(active.id, {
        phase: "unknown",
        message: t("图鉴奖励详情暂时无法确认，请查看最新结果"),
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
    ).filter((control) => !control.closest("[inert]"));
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

  const handleGachaPresentationMounted = useCallback(() => {
    if (activeId && operationsRef.current[activeId]?.routeId === "gacha.open")
      setMountedGachaAnimationId(activeId);
  }, [activeId]);

  const handleGachaImageStatusChange = useCallback(
    (operationId: string, status: GachaImagePreparationStatus) => {
      setGachaImagePreparation((current) => {
        const previous =
          current?.operationId === operationId
            ? current
            : {
                operationId,
                status: "loading" as const,
                retryEpoch: 0,
                hasFailed: false,
              };
        const hasFailed = previous.hasFailed || status === "failed";
        if (previous.status === status && previous.hasFailed === hasFailed)
          return previous;
        return { ...previous, status, hasFailed };
      });
    },
    [],
  );

  const retryGachaImages = useCallback((operationId: string) => {
    setGachaImagePreparation((current) => {
      const previous =
        current?.operationId === operationId
          ? current
          : {
              operationId,
              status: "failed" as const,
              retryEpoch: 0,
              hasFailed: true,
            };
      return {
        ...previous,
        status: "loading",
        retryEpoch: previous.retryEpoch + 1,
        hasFailed: true,
      };
    });
  }, []);

  const GachaHatchAnimation =
    loadedPresentation?.kind === "gacha"
      ? loadedPresentation.module.GachaHatchAnimation
      : null;
  const GachaImageUnavailable =
    loadedPresentation?.kind === "gacha"
      ? loadedPresentation.module.GachaImageUnavailable
      : null;
  const GachaResultDialog =
    loadedPresentation?.kind === "gacha"
      ? loadedPresentation.module.GachaResultDialog
      : null;
  const GachaResultImagePreloader =
    loadedPresentation?.kind === "gacha"
      ? loadedPresentation.module.GachaResultImagePreloader
      : null;
  const EvolutionOperationDialog =
    loadedPresentation?.kind === "evolution"
      ? loadedPresentation.module.EvolutionOperationDialog
      : null;
  const DecompositionOperationDialog =
    loadedPresentation?.kind === "decomposition"
      ? loadedPresentation.module.DecompositionOperationDialog
      : null;
  const marketPresentation =
    loadedPresentation?.kind === "market" ? loadedPresentation.module : null;
  const WheelResultDialog =
    loadedPresentation?.kind === "wheel"
      ? loadedPresentation.module.WheelResultDialog
      : null;
  const AlbumClaimResultDialog =
    loadedPresentation?.kind === "album"
      ? loadedPresentation.module.AlbumClaimResultDialog
      : null;
  const VipDailyClaimResultDialog =
    loadedPresentation?.kind === "vip"
      ? loadedPresentation.module.VipDailyClaimResultDialog
      : null;
  const dedicatedPresentationPending = Boolean(
    active &&
    hasDedicatedPresentation(active.routeId) &&
    !presentationMatchesRoute(loadedPresentation, active.routeId),
  );

  return (
    <>
      {session?.accountStatus === "normal" &&
        !active &&
        resumableUnresolved.length > 0 && (
          <button
            className="operation-resume"
            onClick={() => setActiveId(resumableUnresolved[0]?.id ?? null)}
          >
            {tp("{{0}} 个操作待确认", [resumableUnresolved.length])}
          </button>
        )}
      {active?.routeId === "gacha.open" &&
        gachaResult &&
        GachaResultImagePreloader &&
        gachaResultPreparationReady && (
          <GachaResultImagePreloader key={active.id} result={gachaResult} />
        )}
      {active && showOperationDialog && (
        <div
          ref={dialogRef}
          className={`modal-backdrop operation-dialog-backdrop ${
            active.routeId === "gacha.open"
              ? `gacha-operation-backdrop phase-${active.phase}${showGachaAnimation || showGachaImageUnavailable ? " gacha-hatching-backdrop" : gachaResultVisible ? " gacha-result-backdrop" : ""}`
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
                            : vipClaimResult
                              ? "app-shell result-sheet-backdrop vip-claim-result-backdrop"
                              : ""
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={showGachaAnimation ? t("灵契黑洞汇聚") : undefined}
          aria-labelledby={
            showGachaAnimation
              ? undefined
              : showGachaImageUnavailable
                ? "gacha-image-unavailable-title"
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
                            : vipClaimResult
                              ? "vip-claim-result-title"
                              : albumClaimResult
                                ? "album-claim-result-title"
                                : "operation-dialog-title"
          }
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
        >
          {presentationLoadFailed &&
          hasDedicatedPresentation(active.routeId) ? (
            <PresentationLoadFailure
              retry={() => void loadPresentation(active.id, active.routeId)}
            />
          ) : dedicatedPresentationPending ? (
            <OperationProcessingLayer />
          ) : active.routeId === "market.create_listing" &&
            active.phase === "succeeded" ? (
            marketPresentation ? (
              <marketPresentation.MarketListingSuccessDialog
                onConfirm={dismiss}
              />
            ) : (
              <OperationProcessingLayer />
            )
          ) : active.routeId === "market.create_listing" &&
            active.phase === "failed" ? (
            marketPresentation ? (
              <marketPresentation.MarketListingFailureDialog
                message={marketListingFailureMessage(active.errorCode)}
                onConfirm={dismiss}
              />
            ) : (
              <OperationProcessingLayer />
            )
          ) : active.routeId === "market.purchase" &&
            active.phase === "succeeded" ? (
            marketPurchaseResult && marketPresentation ? (
              <marketPresentation.MarketPurchaseSuccessDialog
                name={marketPurchaseResult.name}
                quantity={marketPurchaseResult.result.quantity}
                onConfirm={dismiss}
              />
            ) : marketPresentation ? (
              <marketPresentation.MarketPurchaseFailureDialog
                message={t("购买状态已更新，请查看最新藏品和余额。")}
                onConfirm={dismiss}
              />
            ) : (
              <OperationProcessingLayer />
            )
          ) : active.routeId === "market.purchase" &&
            active.phase === "failed" ? (
            marketPresentation ? (
              <marketPresentation.MarketPurchaseFailureDialog
                message={marketPurchaseFailureMessage(active.errorCode)}
                onConfirm={dismiss}
              />
            ) : (
              <OperationProcessingLayer />
            )
          ) : active.routeId === "inventory.decompose" &&
            DecompositionOperationDialog ? (
            <DecompositionOperationDialog
              key={active.id}
              operationId={active.id}
              phase={active.phase}
              result={decompositionResult}
              errorCode={active.errorCode}
              presentation={active.presentation}
              onRecover={() => void recover(active)}
              onCollect={dismiss}
            />
          ) : active.routeId === "inventory.evolve" &&
            EvolutionOperationDialog ? (
            <EvolutionOperationDialog
              key={active.id}
              operationId={active.id}
              phase={active.phase}
              input={evolutionInput}
              result={evolutionResult}
              rejectedResult={evolutionRejectedResult}
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
          ) : active.routeId === "gacha.open" &&
            gachaPresentationUnavailable ? (
            <div className="modal gacha-operation-modal phase-succeeded">
              <div className="operation-mark succeeded">✓</div>
              <h2 id="operation-dialog-title">{t("操作已完成")}</h2>
              <p>{t("奖励已存入藏品")}</p>
              <p>{t("画面暂时无法显示")}</p>
              <Button
                onClick={() => {
                  remove(active.id);
                  preparePage("/inventory");
                  navigate("/inventory");
                }}
              >
                {t("查看藏品")}
              </Button>
              <Button
                className="secondary"
                onClick={() => void recover(active)}
              >
                {t("查看最新结果")}
              </Button>
            </div>
          ) : active.routeId === "gacha.open" &&
            gachaResult &&
            GachaResultDialog &&
            gachaResultStageReady ? (
            <>
              <GachaResultDialog
                key={active.id}
                operationId={active.id}
                result={gachaResult}
                busy={gachaActionId === active.id}
                error={
                  gachaActionError?.operationId === active.id
                    ? gachaActionError.message
                    : null
                }
                visible={gachaResultVisible}
                retryEpoch={gachaImageRetryEpoch}
                onImageStatusChange={handleGachaImageStatusChange}
                onRepeat={() => void repeatGacha(active)}
                onInventory={() => {
                  remove(active.id);
                  preparePage("/inventory");
                  navigate("/inventory");
                }}
                onConfirm={() => remove(active.id)}
              />
              {showGachaAnimation && GachaHatchAnimation ? (
                <GachaHatchAnimation
                  tier={
                    active.animationTier ??
                    gachaAnimationTier(active.input, gachaResult)
                  }
                  revealRarity={gachaIsRevealing ? gachaRevealRarity : null}
                  revealing={gachaIsRevealing}
                  onMounted={handleGachaPresentationMounted}
                />
              ) : showGachaImageUnavailable && GachaImageUnavailable ? (
                <GachaImageUnavailable
                  busy={activeGachaImagePreparation?.status === "loading"}
                  onRetry={() => retryGachaImages(active.id)}
                />
              ) : null}
            </>
          ) : showGachaAnimation && GachaHatchAnimation ? (
            <>
              {null}
              <GachaHatchAnimation
                tier={
                  active.animationTier ??
                  gachaAnimationTier(active.input, gachaResult)
                }
                revealRarity={gachaIsRevealing ? gachaRevealRarity : null}
                revealing={gachaIsRevealing}
                onMounted={handleGachaPresentationMounted}
              />
            </>
          ) : wheelResult && WheelResultDialog ? (
            <WheelResultDialog
              result={wheelResult}
              onConfirm={() => remove(active.id)}
            />
          ) : vipClaimResult && VipDailyClaimResultDialog ? (
            <VipDailyClaimResultDialog
              result={vipClaimResult}
              onConfirm={() => remove(active.id)}
            />
          ) : albumClaimResult && AlbumClaimResultDialog ? (
            <AlbumClaimResultDialog
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
                  ? t("开盒结果详情暂时无法确认，请查看最新结果")
                  : invalidWheelSuccess
                    ? t("转盘结果详情暂时无法确认，请查看最新结果")
                    : invalidAlbumClaimSuccess
                      ? t("图鉴奖励详情暂时无法确认，请查看最新结果")
                      : active.message}
              </p>
              {serverAcknowledgementRouteIds.has(active.routeId) &&
              acknowledgementError?.operationId === active.id ? (
                <p className="operation-ack-error">
                  {acknowledgementError.message}
                </p>
              ) : null}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button onClick={() => void recover(active)}>
                  {t("查看最新结果")}
                </Button>
              )}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button className="secondary" onClick={defer}>
                  {t("稍后处理")}
                </Button>
              )}
              {!invalidDedicatedSuccess &&
                !serverAcknowledgementRouteIds.has(active.routeId) &&
                active.routeId !== "gacha.open" &&
                active.routeId !== "wheel.spin" &&
                (active.phase === "succeeded" || active.phase === "failed") && (
                  <Button className="secondary" onClick={dismiss}>
                    {t("完成")}
                  </Button>
                )}
              {active.routeId === "gacha.open" && active.phase === "failed" ? (
                <Button className="secondary" onClick={dismiss}>
                  {t("确定")}
                </Button>
              ) : null}
              {active.routeId === "wheel.spin" && active.phase === "failed" ? (
                <Button className="secondary" onClick={() => remove(active.id)}>
                  {t("确定")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function OperationProcessingLayer(): ReactNode {
  return (
    <div className="modal operation-presentation-loading" role="status">
      <div className="operation-mark pending">…</div>
      <h2>{t("正在处理")}</h2>
      <p>{t("请稍候，结果准备好后会立即显示。")}</p>
    </div>
  );
}

function PresentationLoadFailure({ retry }: { retry(): void }): ReactNode {
  return (
    <div className="modal operation-presentation-loading" role="alert">
      <div className="operation-mark failed">!</div>
      <h2>{t("画面暂时无法显示")}</h2>
      <p>{t("操作状态已保留，重新加载画面不会重复执行操作。")}</p>
      <Button onClick={retry}>{t("重新加载画面")}</Button>
    </div>
  );
}

function hasDedicatedPresentation(routeId: RecoverableRouteId): boolean {
  return (
    routeId === "gacha.open" ||
    routeId === "inventory.evolve" ||
    routeId === "inventory.decompose" ||
    routeId === "market.create_listing" ||
    routeId === "market.purchase" ||
    routeId === "wheel.spin" ||
    routeId === "album.claim" ||
    routeId === "vip.claim_fgems" ||
    routeId === "vip.claim_free_box"
  );
}

function requiresDedicatedValidation(routeId: RecoverableRouteId): boolean {
  return (
    routeId === "gacha.open" ||
    routeId === "inventory.evolve" ||
    routeId === "inventory.decompose" ||
    routeId === "market.purchase" ||
    routeId === "wheel.spin" ||
    routeId === "album.claim" ||
    routeId === "vip.claim_fgems" ||
    routeId === "vip.claim_free_box"
  );
}

function presentationMatchesRoute(
  presentation: LoadedOperationPresentation | null,
  routeId: RecoverableRouteId,
): boolean {
  if (!presentation) return false;
  if (routeId === "gacha.open") return presentation.kind === "gacha";
  if (routeId === "inventory.evolve") return presentation.kind === "evolution";
  if (routeId === "inventory.decompose")
    return presentation.kind === "decomposition";
  if (routeId === "market.create_listing" || routeId === "market.purchase")
    return presentation.kind === "market";
  if (routeId === "wheel.spin") return presentation.kind === "wheel";
  if (routeId === "album.claim") return presentation.kind === "album";
  if (routeId === "vip.claim_fgems" || routeId === "vip.claim_free_box")
    return presentation.kind === "vip";
  return false;
}

async function validateDedicatedOperation(
  operation: RegisteredOperation,
): Promise<ValidatedDedicatedOperation | null> {
  if (operation.routeId === "gacha.open") {
    const route = await loadClientRoute(operation.routeId);
    const parsed =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      result: parsed?.success ? parsed.data : null,
    };
  }
  if (operation.routeId === "wheel.spin") {
    const route = await loadClientRoute(operation.routeId);
    const parsed =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      result: parsed?.success ? parsed.data : null,
    };
  }
  if (operation.routeId === "album.claim") {
    const route = await loadClientRoute(operation.routeId);
    const parsed =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      result: parsed?.success ? parsed.data : null,
    };
  }
  if (
    operation.routeId === "vip.claim_fgems" ||
    operation.routeId === "vip.claim_free_box"
  ) {
    const route = await loadClientRoute(operation.routeId);
    const parsed =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      result: parsed?.success ? parsed.data : null,
    };
  }
  if (operation.routeId === "market.purchase") {
    const route = await loadClientRoute(operation.routeId);
    const input = route.input.safeParse(operation.input);
    const result =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      input: input.success ? input.data : null,
      result: result?.success ? result.data : null,
    };
  }
  if (operation.routeId === "inventory.decompose") {
    const route = await loadClientRoute(operation.routeId);
    const result =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      result: result?.success ? result.data : null,
    };
  }
  if (operation.routeId === "inventory.evolve") {
    const route = await loadClientRoute(operation.routeId);
    const input = route.input.safeParse(operation.input);
    const result =
      operation.phase === "succeeded"
        ? route.output.safeParse(operation.result)
        : null;
    const rejectedResult =
      operation.phase === "failed" && operation.result !== null
        ? await parseEvolutionRejectedResult(operation.result).catch(() => null)
        : null;
    return {
      id: operation.id,
      routeId: operation.routeId,
      input: input.success ? input.data : null,
      result: result?.success ? result.data : null,
      rejectedResult,
    };
  }
  return null;
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

function highestGachaResultRarity(
  result: GachaResult,
): GachaResult["results"][number]["rarity"] {
  const ranks: Record<GachaResult["results"][number]["rarity"], number> = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  };
  return result.results.reduce<GachaResult["results"][number]["rarity"]>(
    (highest, item) =>
      ranks[item.rarity] > ranks[highest] ? item.rarity : highest,
    "common",
  );
}

function recoveredMessage(operation: RecoverableOperationSummary): string {
  if (operation.status === "succeeded")
    return confirmedMessage(operation.use_case, operation.result);
  if (operation.status === "failed")
    return operation.error_code && isErrorCode(operation.error_code)
      ? errorDefinition(operation.error_code).message
      : t("操作未完成");
  return operation.status === "unknown"
    ? t("结果仍在确认，请勿重复操作")
    : t("操作仍在处理中，请勿重复操作");
}

function operationDialogTitle(operation: RegisteredOperation): string {
  if (
    operation.routeId === "gacha.open" &&
    operation.presentationStatus === "unavailable"
  )
    return t("操作已完成");
  if (operation.phase === "succeeded") {
    if (operation.routeId === "market.cancel_template_listings")
      return t("已下架");
  }
  return operation.routeId === "gacha.open" && operation.phase === "failed"
    ? t("开盒失败")
    : operation.label;
}

function confirmedMessage(
  routeId: RecoverableRouteId,
  result: unknown,
): string {
  if (routeId === "market.create_listing") return t("藏品已成功上架");
  if (routeId === "market.purchase") return t("购买成功");
  if (routeId !== "market.cancel_template_listings") return t("操作已完成");
  const releasedQuantity =
    result &&
    typeof result === "object" &&
    "released_quantity" in result &&
    typeof result.released_quantity === "number"
      ? result.released_quantity
      : null;
  if (releasedQuantity === null) return t("已下架，最新状态已刷新");
  return releasedQuantity > 0
    ? tp("已下架，已释放 {{0}} 个未成交藏品", [releasedQuantity])
    : t("已下架，当前没有有效挂单");
}

function marketListingFailureMessage(errorCode: string | null): string {
  if (
    errorCode &&
    playerFacingMarketListingErrorCodes.has(errorCode) &&
    isErrorCode(errorCode)
  )
    return errorDefinition(errorCode).message;
  return t("藏品没有上架，请根据最新的可出售状态重试。");
}

function marketPurchaseFailureMessage(errorCode: string | null): string {
  if (
    errorCode &&
    playerFacingMarketPurchaseErrorCodes.has(errorCode) &&
    isErrorCode(errorCode)
  )
    return errorDefinition(errorCode).message;
  return t("本次购买没有完成，请根据最新库存和余额重试。");
}

function refreshingAuthorityMessage(routeId: RecoverableRouteId): string {
  return routeId === "market.purchase"
    ? t("购买已完成，正在更新藏品和余额")
    : t("上架已确认，正在更新出售状态");
}

function syncingAuthorityMessage(routeId: RecoverableRouteId): string {
  return routeId === "market.purchase"
    ? t("购买状态正在同步")
    : t("上架状态正在同步");
}
