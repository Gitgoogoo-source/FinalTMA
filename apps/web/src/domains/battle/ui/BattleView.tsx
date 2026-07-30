import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  battleTeamSelectionSchema,
  errorDefinition,
  isErrorCode,
  type BattleEntryTier,
  type BattlePageState,
  type BattleRoomSnapshotDto,
  type BattleTeamSelection,
  type RefreshScope,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import {
  ApiFailure,
  apiKeepaliveRequest,
  apiRequest,
} from "../../../platform/api/client.ts";
import {
  getApiQueryData,
  registerForegroundAuthorityRefresh,
  refreshScopes,
  seedApiQuery,
  useApiQuery,
} from "../../../platform/query/index.ts";
import { getSession, useSession } from "../../../platform/session/store.ts";
import {
  sharePreparedMessage,
  subscribePreparedMessageShareEvents,
  subscribeTelegramActivity,
  supportsPreparedMessageSharing,
  telegram,
  type TelegramShareFailure,
} from "../../../platform/telegram/index.ts";
import {
  usePageActive,
  usePageSearchParams,
} from "../../../shared/navigation/pageActivity.tsx";
import { Button } from "../../../shared/ui/index.tsx";
import { useBattleRealtime } from "../../../workflows/battle-realtime/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";
import { useBattleCommand } from "../useBattleCommand.ts";
import { useBattleDeadline } from "../useBattleDeadline.ts";
import {
  isBattleAssetTerminal,
  type BattleTerminalObservation,
  useBattleTerminalRefresh,
} from "../useBattleTerminalRefresh.ts";
import { BattleArena } from "./BattleArena.tsx";
import {
  BattleAccept,
  BattleCancelSheet,
  BattleHome,
  BattleInviteMissing,
  BattleLobby,
  BattlePreparingShare,
  BattleResult,
  BattleResultPending,
  BattleTeamSelect,
  BattleWaiting,
} from "./BattleScreens.tsx";
import type { BattleTeamSlots } from "./TeamSelector.tsx";
import "./battle.css";

type Invite = RouteOutput<"battle.current_invite">;
type InviteRoom = Extract<Invite, { room_id: string }>;
type Flow =
  | { kind: "create"; tier: BattleEntryTier["id"] }
  | { kind: "accept"; roomId: string }
  | null;
type OnlineState = "syncing" | "online" | "offline";
type PresenceLifecycle = {
  roomId: string;
  leaseId: string;
  version: number;
  nextCommandSeq: number;
  ended: boolean;
};

const emptySlots: BattleTeamSlots = [null, null, null];

export function BattleView(): ReactNode {
  const pageActive = usePageActive();
  const [params, setParams] = usePageSearchParams();
  const session = useSession();
  const sessionGeneration = session?.generation ?? null;
  const battleEntry = session?.entryKind === "battle";
  const cachedIdentity = sessionGeneration
    ? getApiQueryData(sessionGeneration, "identity.bootstrap")
    : undefined;
  const cachedBattle = sessionGeneration
    ? getApiQueryData(sessionGeneration, "battle.bootstrap")
    : undefined;
  const cachedTerminalPresent =
    terminalObservationsFor({
      rooms: [cachedBattle?.room],
      participations: [
        cachedBattle?.participation,
        cachedIdentity?.battle_participation,
      ],
    }).length > 0;
  const {
    reportTerminal,
    reportNonTerminalRoom,
    prepareAuthorityRecovery,
    readAuthorityRoom,
    finishAuthorityRecovery,
    prepareTerminalAcknowledgement,
    confirmTerminalAcknowledged,
    failure: terminalRefreshFailure,
    active: activeTerminal,
    isLocked: isTerminalLocked,
  } = useBattleTerminalRefresh(sessionGeneration, pageActive);
  const { requestTopup } = useNavigationIntent();
  const identity = useApiQuery(
    "identity.bootstrap",
    {},
    pageActive && activeTerminal === null && !cachedTerminalPresent,
  );
  const identityTerminalParticipation =
    identity.data?.battle_participation &&
    isBattleAssetTerminal(identity.data.battle_participation.status)
      ? identity.data.battle_participation
      : null;
  const bootstrap = useApiQuery(
    "battle.bootstrap",
    {},
    pageActive &&
      activeTerminal === null &&
      !cachedTerminalPresent &&
      identityTerminalParticipation === null,
  );
  const participation =
    bootstrap.data?.participation ??
    (bootstrap.data ? null : (identity.data?.battle_participation ?? null));
  const bootstrapRoomTerminal = Boolean(
    bootstrap.data?.room && isBattleAssetTerminal(bootstrap.data.room.status),
  );
  const roomId = participation?.room_id ?? null;
  const invite = useApiQuery(
    "battle.current_invite",
    {},
    pageActive &&
      (battleEntry || roomId === null) &&
      activeTerminal === null &&
      !cachedTerminalPresent &&
      !bootstrapRoomTerminal,
  );
  const authoritativeInvite = invite.isError ? undefined : invite.data;
  const inviteRoom = isInviteRoom(authoritativeInvite)
    ? authoritativeInvite
    : null;
  const resumeOrderId = params.get("resume");
  const topups = useApiQuery(
    "topup.bootstrap",
    {},
    pageActive && resumeOrderId !== null,
  );
  const [flow, setFlow] = useState<Flow>(null);
  const [slots, setSlots] = useState<BattleTeamSlots>(emptySlots);
  const [room, setRoom] = useState<BattleRoomSnapshotDto | null>(null);
  const [forceHome, setForceHome] = useState(false);
  const [dismissedResult, setDismissedResult] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shareState, setShareState] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [actionIntent, setActionIntent] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [onlineState, setOnlineState] = useState<OnlineState>("syncing");
  const [telegramActive, setTelegramActive] = useState(
    () => telegram()?.isActive !== false,
  );
  const [lifecycleReady, setLifecycleReady] = useState(false);
  const battleRootRef = useRef<HTMLDivElement>(null);
  const handledResume = useRef(new Set<string>());
  const presenceRoomRef = useRef<string | null>(null);
  const roomRef = useRef<BattleRoomSnapshotDto | null>(null);
  const presenceLifecycle = useRef<PresenceLifecycle | null>(null);
  const heartbeatRequests = useRef(new Set<AbortController>());
  const lifecycleRun = useRef(0);
  const lifecycleReadyRef = useRef(false);
  const authorityHealthy = useRef(false);
  const authorityInFlight = useRef<Promise<boolean> | null>(null);
  const foregroundAuthorityOwner = useRef(
    Symbol("battle-foreground-authority"),
  );
  const refetchBootstrap = bootstrap.refetch;
  const refetchInvite = invite.refetch;

  const applySnapshot = useCallback((snapshot: BattleRoomSnapshotDto) => {
    seedApiQuery("battle.room", { room_id: snapshot.room_id }, snapshot);
    setRoom((current) =>
      current?.room_id === snapshot.room_id &&
      compareSnapshots(current, snapshot) > 0
        ? current
        : snapshot,
    );
  }, []);
  const onAuthoritativeRoom = useCallback(
    (snapshot: BattleRoomSnapshotDto): Promise<void> => {
      if (getSession()?.generation !== sessionGeneration)
        return Promise.resolve();
      applySnapshot(snapshot);
      if (isBattleAssetTerminal(snapshot.status)) {
        presenceRoomRef.current = null;
        lifecycleReadyRef.current = false;
        for (const request of heartbeatRequests.current) request.abort();
        heartbeatRequests.current.clear();
        return reportTerminal({
          roomId: snapshot.room_id,
          stateVersion: snapshot.state_version,
        });
      }
      reportNonTerminalRoom(snapshot.room_id);
      return Promise.resolve();
    },
    [applySnapshot, reportNonTerminalRoom, reportTerminal, sessionGeneration],
  );
  const authorityRoomId = room?.room_id ?? roomId ?? null;
  const runAuthorityRefresh = useCallback(async (): Promise<boolean> => {
    if (activeTerminal) {
      await reportTerminal(activeTerminal);
      if (!isTerminalLocked(null)) return false;
      authorityHealthy.current = true;
      return false;
    }
    authorityHealthy.current = false;
    try {
      if (authorityRoomId) {
        const roomResult = await readAuthorityRoom(authorityRoomId);
        if (isTerminalLocked(null)) return false;
        if (!roomResult) return false;
        let inviteHealthy = true;
        if (battleEntry && !forceHome) {
          const inviteResult = await refetchInvite();
          inviteHealthy = !inviteResult.isError;
          if (isTerminalLocked(null)) return false;
        }
        await onAuthoritativeRoom(roomResult);
        if (isTerminalLocked(null)) {
          authorityHealthy.current = true;
          return false;
        }
        authorityHealthy.current = true;
        return inviteHealthy;
      }
      const [battleResult, inviteResult] = await Promise.all([
        refetchBootstrap(),
        refetchInvite(),
      ]);
      if (isTerminalLocked(null)) return false;
      authorityHealthy.current = !battleResult.isError || !inviteResult.isError;
      if (battleResult.data?.room) {
        await onAuthoritativeRoom(battleResult.data.room);
        if (isTerminalLocked(null)) {
          authorityHealthy.current = true;
          return false;
        }
      }
      return authorityHealthy.current && !isTerminalLocked(null);
    } catch {
      authorityHealthy.current = false;
      return false;
    } finally {
      if (authorityRoomId && !isTerminalLocked(null))
        finishAuthorityRecovery(authorityRoomId);
    }
  }, [
    activeTerminal,
    authorityRoomId,
    battleEntry,
    finishAuthorityRecovery,
    forceHome,
    isTerminalLocked,
    onAuthoritativeRoom,
    readAuthorityRoom,
    refetchBootstrap,
    refetchInvite,
    reportTerminal,
  ]);
  const refetchAuthority = useCallback((): Promise<boolean> => {
    const existing = authorityInFlight.current;
    if (existing) return existing;
    const task = runAuthorityRefresh().finally(() => {
      if (authorityInFlight.current === task) authorityInFlight.current = null;
    });
    authorityInFlight.current = task;
    return task;
  }, [runAuthorityRefresh]);
  const refetchAuthorityVoid = useCallback(async (): Promise<void> => {
    await refetchAuthority();
  }, [refetchAuthority]);
  const refetchRef = useRef(refetchAuthority);
  useEffect(() => {
    refetchRef.current = refetchAuthority;
  }, [refetchAuthority]);
  useEffect(() => {
    if (!pageActive || !sessionGeneration) return;
    return registerForegroundAuthorityRefresh(
      foregroundAuthorityOwner.current,
      {
        generation: sessionGeneration,
        pathname: "/game",
        handledPrefixes: ["battle"],
        refresh: refetchAuthority,
      },
    );
  }, [pageActive, refetchAuthority, sessionGeneration]);
  const command = useBattleCommand(
    refetchAuthorityVoid,
    onAuthoritativeRoom,
    readAuthorityRoom,
  );
  const commandPending =
    command.state.phase === "submitted" || command.state.phase === "recovering";

  useEffect(() => {
    if (pageActive) return;
    queueMicrotask(() => {
      setCancelOpen(false);
      setSwitchOpen(false);
    });
  }, [pageActive]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setFlow(null);
      setSlots(emptySlots);
      setRoom(null);
      setForceHome(false);
      setDismissedResult(null);
      setResumeNotice(null);
      setFeedback(null);
      setShareState(null);
      setCancelOpen(false);
      setSwitchOpen(false);
      setActionIntent(null);
      handledResume.current.clear();
      for (const request of heartbeatRequests.current) request.abort();
      heartbeatRequests.current.clear();
      presenceLifecycle.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [sessionGeneration]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const candidates = [bootstrap.data?.room].filter(
        (candidate): candidate is BattleRoomSnapshotDto => Boolean(candidate),
      );
      if (candidates.length === 0) {
        if (bootstrap.data && bootstrap.data.participation === null)
          setRoom(null);
        return;
      }
      const next = candidates.reduce((newest, candidate) =>
        compareSnapshots(candidate, newest) > 0 ? candidate : newest,
      );
      void onAuthoritativeRoom(next);
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap.data, onAuthoritativeRoom]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const currentResult =
    bootstrap.data?.current_result ??
    (bootstrap.data ? null : (identity.data?.battle_result ?? null));
  const result =
    currentResult?.room_id === dismissedResult ? null : currentResult;
  const terminalObservations = useMemo(
    () =>
      terminalObservationsFor({
        rooms: [room, bootstrap.data?.room],
        participations: [
          participation,
          bootstrap.data?.participation,
          identity.data?.battle_participation,
        ],
      }),
    [
      bootstrap.data?.participation,
      bootstrap.data?.room,
      identity.data?.battle_participation,
      participation,
      room,
    ],
  );
  const terminalObservationKey = terminalObservations
    .map((observation) => `${observation.roomId}:${observation.stateVersion}`)
    .join(",");
  const pageState = derivePageState({
    result: Boolean(result),
    room,
    flow,
    invite: authoritativeInvite,
    battleEntry,
    forceHome,
  });
  const tier =
    flow?.kind === "create"
      ? (bootstrap.data?.entry_tiers.find(
          (candidate) => candidate.id === flow.tier,
        ) ?? null)
      : null;
  const teamOptions = useApiQuery(
    "battle.team_options",
    {},
    pageActive &&
      (pageState === "team_select" ||
        (pageState === "accept" && inviteRoom?.invite_status === "available")),
  );
  const balance = identity.data?.assets.kcoin.available ?? null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      for (const observation of terminalObservations)
        void reportTerminal(observation);
    });
    return () => {
      cancelled = true;
    };
  }, [reportTerminal, terminalObservationKey, terminalObservations]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled ||
        !resumeOrderId ||
        handledResume.current.has(resumeOrderId)
      )
        return;
      const order = topups.data?.orders.find(
        (candidate) => candidate.id === resumeOrderId,
      );
      if (!order) {
        if (!topups.isLoading) {
          handledResume.current.add(resumeOrderId);
          setResumeNotice("未找到可恢复的充值操作，请重新选择 Battle 操作");
          setParams({}, { replace: true });
        }
        return;
      }
      if (!order.intent) return;
      if (
        order.intent.kind !== "battle_create" &&
        order.intent.kind !== "battle_accept"
      )
        return;
      handledResume.current.add(resumeOrderId);
      const restored: BattleTeamSlots = [...order.intent.template_ids];
      setSlots(restored);
      if (order.intent.kind === "battle_create") {
        setFlow({ kind: "create", tier: order.intent.tier });
        setForceHome(false);
        setResumeNotice(
          "充值返回后已恢复原档位和队伍，请重新确认；页面不会自动创建。",
        );
      } else if (
        inviteRoom &&
        inviteRoom.room_id === order.intent.room_id &&
        inviteRoom.invite_status === "available"
      ) {
        setFlow({ kind: "accept", roomId: inviteRoom.room_id });
        setForceHome(false);
        setResumeNotice(
          "充值返回后已恢复原邀请和队伍，请重新确认；页面不会自动接受。",
        );
      } else if (!invite.isLoading) {
        setResumeNotice("原邀请已不可接受，页面没有自动支付或占用藏品");
        setForceHome(false);
      } else {
        handledResume.current.delete(resumeOrderId);
        return;
      }
      setParams({}, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [
    invite.isLoading,
    inviteRoom,
    resumeOrderId,
    setParams,
    topups.data,
    topups.isLoading,
  ]);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (room.viewer_action_state === "locked") setActionIntent(null);
      if (room.status !== "active_select") setSwitchOpen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [room]);

  const deadline = deadlineFor(pageState, room, participation, inviteRoom);
  const clock = useBattleDeadline({
    ...deadline,
    onExpire: () => void refetchRef.current(),
  });
  const lobbyStartClock = useBattleDeadline({
    serverTime: room?.server_time ?? null,
    deadline: room?.lobby?.start_deadline ?? null,
    durationSeconds: room?.lobby?.start_deadline ? 3 : null,
    onExpire: () => void refetchRef.current(),
  });
  const creatorReconnectClock = useBattleDeadline({
    serverTime: room?.server_time ?? null,
    deadline: room?.lobby?.presence.creator.reconnect_deadline ?? null,
    durationSeconds: room?.lobby?.presence.creator.reconnect_deadline
      ? 90
      : null,
    onExpire: () => void refetchRef.current(),
  });
  const opponentReconnectClock = useBattleDeadline({
    serverTime: room?.server_time ?? null,
    deadline: room?.lobby?.presence.opponent.reconnect_deadline ?? null,
    durationSeconds: room?.lobby?.presence.opponent.reconnect_deadline
      ? 90
      : null,
    onExpire: () => void refetchRef.current(),
  });
  const realtimePhase = realtimePhaseFor(pageState, room);
  const realtime = useBattleRealtime({
    enabled:
      pageActive &&
      Boolean(session) &&
      realtimePhase !== "idle" &&
      pageState !== "result" &&
      !isTerminalLocked(room?.room_id ?? roomId),
    pageActive,
    contextKey: room?.room_id ?? inviteRoom?.room_id ?? session?.userId ?? "",
    phase: realtimePhase,
    stateVersion: room?.state_version ?? participation?.state_version ?? 0,
    refetch: refetchAuthorityVoid,
  });

  useEffect(() => {
    presenceRoomRef.current =
      (room?.status === "waiting" && room.side === "creator") ||
      room?.status === "lobby_waiting" ||
      room?.status === "lobby_countdown"
        ? room.room_id
        : null;
  }, [room]);
  const prepareRecovery = useCallback(() => {
    const targetRoomId = roomRef.current?.room_id ?? authorityRoomId;
    if (targetRoomId) prepareAuthorityRecovery(targetRoomId);
  }, [authorityRoomId, prepareAuthorityRecovery]);
  const markOffline = useCallback(() => {
    lifecycleReadyRef.current = false;
    const presenceRoomId = presenceRoomRef.current;
    if (isTerminalLocked(presenceRoomId)) return;
    const snapshot = roomRef.current;
    if (!presenceRoomId || !snapshot || snapshot.room_id !== presenceRoomId)
      return;
    const current = presenceLifecycle.current;
    if (current?.roomId === presenceRoomId && current.ended) return;
    const lifecycle = presenceLifecycleFor(snapshot, current);
    lifecycle.ended = true;
    presenceLifecycle.current = lifecycle;
    for (const request of heartbeatRequests.current) request.abort();
    heartbeatRequests.current.clear();
    setOnlineState("offline");
    const commandSeq = ++lifecycle.nextCommandSeq;
    void apiKeepaliveRequest("battle.offline", {
      room_id: presenceRoomId,
      presence_lease_id: lifecycle.leaseId,
      presence_lifecycle_version: lifecycle.version,
      presence_command_seq: commandSeq,
    })
      .then((response) => {
        return onAuthoritativeRoom(response.data);
      })
      .catch(async (cause: unknown) => {
        await applyPresenceFailureScopes(cause);
        if (
          document.visibilityState === "visible" &&
          telegram()?.isActive !== false
        )
          await refetchRef.current();
      });
  }, [isTerminalLocked, onAuthoritativeRoom]);

  useEffect(() => {
    const run = ++lifecycleRun.current;
    const activeNow = () =>
      pageActive &&
      document.visibilityState === "visible" &&
      telegram()?.isActive !== false;
    const restore = async () => {
      if (!activeNow()) return;
      lifecycleReadyRef.current = false;
      setLifecycleReady(false);
      await refetchRef.current();
      if (
        run !== lifecycleRun.current ||
        !activeNow() ||
        !authorityHealthy.current
      ) {
        setOnlineState("offline");
        return;
      }
      lifecycleReadyRef.current = true;
      setLifecycleReady(true);
    };
    const activated = () => {
      setTelegramActive(true);
      void restore();
    };
    const deactivated = () => {
      setTelegramActive(false);
      setLifecycleReady(false);
      prepareRecovery();
      markOffline();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void restore();
      else {
        setLifecycleReady(false);
        prepareRecovery();
        markOffline();
      }
    };
    const online = () => void restore();
    const pagehide = () => {
      setLifecycleReady(false);
      prepareRecovery();
      markOffline();
    };
    const offline = () => prepareRecovery();
    const pageshow = () => void restore();
    const unsubscribe = subscribeTelegramActivity(activated, deactivated);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    if (activeNow()) void restore();
    else {
      prepareRecovery();
      markOffline();
    }
    return () => {
      lifecycleRun.current += 1;
      lifecycleReadyRef.current = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      markOffline();
    };
  }, [markOffline, pageActive, prepareRecovery, sessionGeneration]);

  useEffect(() => {
    const presenceRoomId = presenceRoomRef.current;
    if (
      !presenceRoomId ||
      !pageActive ||
      !telegramActive ||
      !lifecycleReady ||
      !lifecycleReadyRef.current ||
      document.visibilityState !== "visible"
    )
      return;
    let disposed = false;
    let inFlight = false;
    const snapshot = roomRef.current;
    if (!snapshot || snapshot.room_id !== presenceRoomId) return;
    const lifecycle = presenceLifecycleFor(snapshot, presenceLifecycle.current);
    presenceLifecycle.current = lifecycle;
    let timer = 0;
    const stop = () => {
      disposed = true;
      window.clearInterval(timer);
    };
    const resync = async () => {
      stop();
      setLifecycleReady(false);
      await refetchRef.current();
      if (
        pageActive &&
        document.visibilityState === "visible" &&
        telegram()?.isActive !== false &&
        authorityHealthy.current
      ) {
        lifecycleReadyRef.current = true;
        setLifecycleReady(true);
      }
    };
    const heartbeat = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      const controller = new AbortController();
      heartbeatRequests.current.add(controller);
      const commandSeq = ++lifecycle.nextCommandSeq;
      try {
        const response = await apiRequest(
          "battle.heartbeat",
          {
            room_id: presenceRoomId,
            presence_lease_id: lifecycle.leaseId,
            presence_lifecycle_version: lifecycle.version,
            presence_command_seq: commandSeq,
          },
          { signal: controller.signal },
        );
        if (disposed) return;
        void onAuthoritativeRoom(response.data);
        if (
          response.data.status !== "waiting" &&
          response.data.status !== "lobby_waiting" &&
          response.data.status !== "lobby_countdown"
        ) {
          stop();
          if (!isBattleAssetTerminal(response.data.status))
            await refetchRef.current();
          return;
        }
        const acknowledged = response.data.presence_lifecycle;
        if (
          acknowledged.version !== lifecycle.version ||
          acknowledged.lease_id !== lifecycle.leaseId ||
          acknowledged.last_command_seq < commandSeq ||
          !acknowledged.active
        ) {
          lifecycle.ended = true;
          setOnlineState("offline");
          void resync();
          return;
        }
        setOnlineState("online");
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setOnlineState("offline");
        await applyPresenceFailureScopes(cause);
        if (cause instanceof ApiFailure && !cause.retryable) {
          lifecycle.ended = true;
          void resync();
        }
      } finally {
        heartbeatRequests.current.delete(controller);
        inFlight = false;
      }
    };
    setOnlineState("syncing");
    void heartbeat();
    timer = window.setInterval(heartbeat, 5_000);
    return stop;
  }, [
    lifecycleReady,
    pageActive,
    onAuthoritativeRoom,
    room?.room_id,
    room?.side,
    room?.status,
    sessionGeneration,
    telegramActive,
  ]);

  useEffect(() => {
    if (room?.status !== "waiting" || room.side !== "creator") return;
    return subscribePreparedMessageShareEvents(
      () => setShareState("挑战卡已发送，房间继续等待首位有效对手"),
      (failure) => {
        setShareState(shareFailureText(failure));
        if (failure === "MESSAGE_EXPIRED") void refetchRef.current();
      },
    );
  }, [room?.room_id, room?.side, room?.status]);

  const create = async () => {
    if (!tier) return;
    const selection = parseSelection(slots, teamOptions.data?.items ?? []);
    if (!selection) {
      setFeedback("请选择恰好三个不同的可用模板，并确认首发顺序");
      return;
    }
    if (balance === null) {
      setFeedback("K-coin 余额尚未读取完成");
      return;
    }
    if (balance < tier.entry_fee) {
      requestTopup(
        { kind: "battle_create", tier: tier.id, template_ids: selection },
        tier.entry_fee - balance,
      );
      setResumeNotice("请完成充值；返回后仍需重新确认创建");
      return;
    }
    setFeedback("创建请求已提交，尚未代表业务成功");
    const response = await command.execute("battle.create", {
      tier: tier.id,
      template_ids: selection,
    });
    if (!response) {
      setFeedback(null);
      return;
    }
    setFlow(null);
    setFeedback(null);
  };

  const accept = async () => {
    if (!inviteRoom || inviteRoom.invite_status !== "available") return;
    const selection = parseSelection(slots, teamOptions.data?.items ?? []);
    if (!selection) {
      setFeedback("请选择恰好三个不同的可用模板，并确认首发顺序");
      return;
    }
    if (balance === null) {
      setFeedback("K-coin 余额尚未读取完成");
      return;
    }
    if (balance < inviteRoom.entry_fee) {
      requestTopup(
        {
          kind: "battle_accept",
          room_id: inviteRoom.room_id,
          template_ids: selection,
        },
        inviteRoom.entry_fee - balance,
      );
      setResumeNotice("请完成充值；返回后仍需重新确认接受");
      return;
    }
    setFeedback("接受请求已提交，尚未代表业务成功");
    const snapshot = await command.execute(
      "battle.accept",
      {
        template_ids: selection,
      },
      {
        terminalRoomId: inviteRoom.room_id,
      },
    );
    if (!snapshot) {
      setFeedback(null);
      return;
    }
    setFlow(null);
    setResumeNotice(null);
    setFeedback(null);
  };

  const cancel = async () => {
    if (!room) return;
    const response = await command.execute("battle.cancel", {
      room_id: room.room_id,
    });
    if (!response) return;
    setCancelOpen(false);
    setFeedback(null);
  };

  const attack = async (skillPosition: 1 | 2 | 3 | 4, name: string) => {
    if (!room || room.viewer_action_state !== "available") return;
    setActionIntent(name);
    const snapshot = await command.execute("battle.action", {
      room_id: room.room_id,
      kind: "attack",
      turn_no: room.turn_no,
      skill_position: skillPosition,
    });
    if (!snapshot) setActionIntent(null);
  };

  const voluntarySwitch = async (teamSlot: 1 | 2 | 3, name: string) => {
    if (!room || room.viewer_action_state !== "available") return;
    setActionIntent(`换入${name}`);
    const snapshot = await command.execute("battle.action", {
      room_id: room.room_id,
      kind: "switch",
      turn_no: room.turn_no,
      team_slot: teamSlot,
    });
    if (!snapshot) setActionIntent(null);
  };

  const forcedSwitch = async (teamSlot: 1 | 2 | 3, name: string) => {
    if (!room || room.viewer_action_state !== "available") return;
    setActionIntent(`换入${name}`);
    const snapshot = await command.execute("battle.forced_switch", {
      room_id: room.room_id,
      turn_no: room.turn_no,
      team_slot: teamSlot,
    });
    if (!snapshot) setActionIntent(null);
  };

  const acknowledge = async () => {
    if (!result || acknowledging) return;
    const acknowledgedRoomId = result.room_id;
    setAcknowledging(true);
    setFeedback("正在由服务器确认结果已读");
    let acknowledgementFailure: unknown = null;
    try {
      if (!(await prepareTerminalAcknowledgement(acknowledgedRoomId))) {
        setFeedback("当场结果仍在完成权威资产回正，请重试确认");
        return;
      }
      try {
        await apiRequest("battle.acknowledge_result", {
          room_id: acknowledgedRoomId,
        });
      } catch (cause) {
        acknowledgementFailure = cause;
      }
      const confirmed = await confirmTerminalAcknowledged(acknowledgedRoomId);
      if (!confirmed) {
        setFeedback(
          acknowledgementFailure instanceof Error
            ? acknowledgementFailure.message
            : "结果确认尚未完成权威回正，请重试",
        );
        return;
      }
      setDismissedResult(acknowledgedRoomId);
      setForceHome(true);
      setFlow(null);
      setSlots(emptySlots);
      setRoom((current) =>
        current?.room_id === acknowledgedRoomId ? null : current,
      );
      setFeedback(null);
    } finally {
      setAcknowledging(false);
    }
  };

  const share = () => {
    if (!room?.prepared_message_id) return;
    setShareState("已打开 Telegram 分享面板，房间仍保持等待");
    const opened = sharePreparedMessage(room.prepared_message_id, (shared) => {
      if (!shared)
        setShareState("分享面板已关闭或发送未完成，房间继续等待，可再次分享");
    });
    if (!opened)
      setShareState(
        "当前 Telegram 版本不支持发送挑战卡，请更新 Telegram 后重试",
      );
  };

  const queryError =
    bootstrap.error ?? identity.error ?? invite.error ?? teamOptions.error;
  const visibleError = terminalRefreshFailure?.error ?? queryError;
  const loading =
    bootstrap.isLoading ||
    identity.isLoading ||
    (battleEntry && !forceHome
      ? invite.isFetching
      : roomId
        ? room === null
        : invite.isLoading);
  const commandMessage =
    commandPending || command.state.phase === "failed"
      ? command.state.message
      : null;
  const content = (
    <BattleState
      pageState={pageState}
      room={room}
      result={result}
      tier={tier}
      invite={authoritativeInvite}
      tiers={bootstrap.data?.entry_tiers ?? []}
      participation={participation}
      teamItems={teamOptions.data?.items ?? []}
      slots={slots}
      balance={balance}
      loading={loading}
      commandPending={commandPending}
      actionIntent={actionIntent}
      switchOpen={switchOpen}
      modalActive={pageActive}
      modalBackgroundRef={battleRootRef}
      acknowledging={acknowledging}
      clock={clock}
      lobbyStartClock={lobbyStartClock}
      creatorReconnectClock={creatorReconnectClock}
      opponentReconnectClock={opponentReconnectClock}
      realtimeOffline={realtime === "offline"}
      onlineState={onlineState}
      shareState={shareState}
      shareSupported={supportsPreparedMessageSharing()}
      resumeNotice={resumeNotice}
      setSlots={setSlots}
      setSwitchOpen={setSwitchOpen}
      chooseTier={(chosenTier) => {
        setFlow({ kind: "create", tier: chosenTier });
        setSlots(emptySlots);
        setForceHome(false);
        setFeedback(null);
      }}
      home={() => {
        setFlow(null);
        setSlots(emptySlots);
        setForceHome(true);
        setResumeNotice(null);
        setFeedback(null);
        setParams({}, { replace: true });
      }}
      refresh={() => void refetchAuthority()}
      create={() => void create()}
      accept={() => void accept()}
      share={share}
      cancel={() => setCancelOpen(true)}
      attack={(position, name) => void attack(position, name)}
      voluntarySwitch={(slot, name) => void voluntarySwitch(slot, name)}
      forcedSwitch={(slot, name) => void forcedSwitch(slot, name)}
      acknowledge={() => void acknowledge()}
    />
  );

  return (
    <div
      ref={battleRootRef}
      className="battle-root"
      data-battle-page-state={pageState}
    >
      {content}
      {feedback || commandMessage || visibleError ? (
        <div
          className={`battle-feedback ${visibleError ? "error" : ""}`}
          role={visibleError ? "alert" : "status"}
          aria-live="polite"
        >
          {visibleError ? <AlertTriangle /> : <RefreshCw />}
          <span>
            {visibleError instanceof Error
              ? visibleError.message
              : (feedback ?? commandMessage)}
          </span>
          {visibleError ? (
            <Button
              className="secondary"
              onClick={() => {
                if (terminalRefreshFailure) {
                  void reportTerminal({
                    roomId: terminalRefreshFailure.roomId,
                    stateVersion: terminalRefreshFailure.stateVersion,
                  });
                } else {
                  void refetchAuthority();
                }
              }}
            >
              重新读取
            </Button>
          ) : null}
        </div>
      ) : null}
      {cancelOpen && pageActive ? (
        <BattleCancelSheet
          pending={commandPending}
          backgroundRef={battleRootRef}
          onClose={() => setCancelOpen(false)}
          onConfirm={() => void cancel()}
        />
      ) : null}
    </div>
  );
}

function BattleState({
  pageState,
  room,
  result,
  tier,
  invite,
  tiers,
  participation,
  teamItems,
  slots,
  balance,
  loading,
  commandPending,
  actionIntent,
  switchOpen,
  modalActive,
  modalBackgroundRef,
  acknowledging,
  clock,
  lobbyStartClock,
  creatorReconnectClock,
  opponentReconnectClock,
  realtimeOffline,
  onlineState,
  shareState,
  shareSupported,
  resumeNotice,
  setSlots,
  setSwitchOpen,
  chooseTier,
  home,
  refresh,
  create,
  accept,
  share,
  cancel,
  attack,
  voluntarySwitch,
  forcedSwitch,
  acknowledge,
}: {
  pageState: BattlePageState;
  room: BattleRoomSnapshotDto | null;
  result: RouteOutput<"battle.bootstrap">["current_result"];
  tier: BattleEntryTier | null;
  invite: Invite | undefined;
  tiers: readonly BattleEntryTier[];
  participation: RouteOutput<"battle.bootstrap">["participation"];
  teamItems: RouteOutput<"battle.team_options">["items"];
  slots: BattleTeamSlots;
  balance: number | null;
  loading: boolean;
  commandPending: boolean;
  actionIntent: string | null;
  switchOpen: boolean;
  modalActive: boolean;
  modalBackgroundRef: RefObject<HTMLElement | null>;
  acknowledging: boolean;
  clock: ReturnType<typeof useBattleDeadline>;
  lobbyStartClock: ReturnType<typeof useBattleDeadline>;
  creatorReconnectClock: ReturnType<typeof useBattleDeadline>;
  opponentReconnectClock: ReturnType<typeof useBattleDeadline>;
  realtimeOffline: boolean;
  onlineState: OnlineState;
  shareState: string | null;
  shareSupported: boolean;
  resumeNotice: string | null;
  setSlots(slots: BattleTeamSlots): void;
  setSwitchOpen(open: boolean): void;
  chooseTier(tier: BattleEntryTier["id"]): void;
  home(): void;
  refresh(): void;
  create(): void;
  accept(): void;
  share(): void;
  cancel(): void;
  attack(position: 1 | 2 | 3 | 4, name: string): void;
  voluntarySwitch(slot: 1 | 2 | 3, name: string): void;
  forcedSwitch(slot: 1 | 2 | 3, name: string): void;
  acknowledge(): void;
}): ReactNode {
  if (pageState === "result" && result)
    return (
      <BattleResult
        result={result}
        acknowledging={acknowledging}
        onAcknowledge={acknowledge}
      />
    );
  if (pageState === "result")
    return <BattleResultPending onRefresh={refresh} />;
  if (pageState === "preparing_share" && room)
    return (
      <BattlePreparingShare
        snapshot={room}
        remainingSeconds={clock.remainingSeconds}
        progressPercent={clock.progressPercent}
        onRefresh={refresh}
      />
    );
  if (pageState === "waiting" && room && participation)
    return (
      <BattleWaiting
        snapshot={room}
        entryFee={participation.entry_fee}
        remainingSeconds={clock.remainingSeconds}
        realtimeOffline={realtimeOffline}
        onlineState={onlineState}
        shareState={shareState}
        shareSupported={shareSupported}
        commandPending={commandPending}
        onShare={share}
        onCancel={cancel}
        onRefresh={refresh}
      />
    );
  if (pageState === "lobby" && room?.lobby)
    return (
      <BattleLobby
        lobby={room.lobby}
        remainingSeconds={clock.remainingSeconds}
        countdownSeconds={lobbyStartClock.remainingSeconds}
        creatorReconnectSeconds={creatorReconnectClock.remainingSeconds}
        opponentReconnectSeconds={opponentReconnectClock.remainingSeconds}
        realtimeOffline={realtimeOffline}
      />
    );
  if ((pageState === "battle" || pageState === "forced_switch") && room)
    return (
      <BattleArena
        snapshot={room}
        remainingSeconds={clock.remainingSeconds}
        actionIntent={actionIntent}
        commandPending={commandPending}
        switchOpen={switchOpen}
        modalActive={modalActive}
        modalBackgroundRef={modalBackgroundRef}
        setSwitchOpen={setSwitchOpen}
        onAttack={attack}
        onSwitch={voluntarySwitch}
        onForcedSwitch={forcedSwitch}
      />
    );
  if (pageState === "team_select" && tier)
    return (
      <BattleTeamSelect
        tier={tier}
        items={teamItems}
        slots={slots}
        balance={balance}
        loading={loading}
        disabled={commandPending}
        onChange={setSlots}
        onBack={home}
        onConfirm={create}
      />
    );
  if (pageState === "accept") {
    if (!isInviteRoom(invite))
      return (
        <BattleInviteMissing
          invalid={invite?.invite_status === "invalid"}
          loading={loading}
          onHome={home}
          onRefresh={refresh}
        />
      );
    return (
      <BattleAccept
        invite={invite}
        items={teamItems}
        slots={slots}
        balance={balance}
        remainingSeconds={clock.remainingSeconds}
        loading={loading}
        disabled={commandPending}
        realtimeOffline={realtimeOffline}
        resumeNotice={resumeNotice}
        onChange={setSlots}
        onConfirm={accept}
        onHome={home}
        onRefresh={refresh}
      />
    );
  }
  return (
    <BattleHome
      tiers={tiers}
      participation={participation}
      loading={loading}
      onChooseTier={chooseTier}
      onRefresh={refresh}
    />
  );
}

function derivePageState({
  result,
  room,
  flow,
  invite,
  battleEntry,
  forceHome,
}: {
  result: boolean;
  room: BattleRoomSnapshotDto | null;
  flow: Flow;
  invite: Invite | undefined;
  battleEntry: boolean;
  forceHome: boolean;
}): BattlePageState {
  if (result) return "result";
  if (!forceHome && battleEntry) return "accept";
  if (room) {
    if (room.status === "preparing_share") return "preparing_share";
    if (room.status === "waiting") return "waiting";
    if (room.status === "lobby_waiting" || room.status === "lobby_countdown")
      return "lobby";
    if (room.status === "forced_switch") return "forced_switch";
    if (room.status === "active_select" || room.status === "reveal")
      return "battle";
    if (
      room.status === "finished" ||
      room.status === "draw" ||
      room.status === "voided"
    )
      return "result";
  }
  if (flow?.kind === "create") return "team_select";
  if (flow?.kind === "accept") return "accept";
  if (!forceHome && isInviteRoom(invite)) return "accept";
  return "home";
}

function deadlineFor(
  state: BattlePageState,
  room: BattleRoomSnapshotDto | null,
  participation: RouteOutput<"battle.bootstrap">["participation"],
  invite: InviteRoom | null,
): {
  serverTime: string | null;
  deadline: string | null;
  durationSeconds: number | null;
} {
  if (state === "accept" && invite)
    return {
      serverTime: invite.server_time,
      deadline: invite.expires_at,
      durationSeconds: 1_800,
    };
  if (!room) return { serverTime: null, deadline: null, durationSeconds: null };
  if (state === "preparing_share")
    return {
      serverTime: room.server_time,
      deadline: room.prepare_deadline,
      durationSeconds: 60,
    };
  if (state === "waiting")
    return {
      serverTime: room.server_time,
      deadline: participation?.expires_at ?? null,
      durationSeconds: 1_800,
    };
  if (state === "lobby" && room.lobby)
    return {
      serverTime: room.server_time,
      deadline: room.lobby.expires_at,
      durationSeconds: 300,
    };
  if (room.status === "reveal")
    return {
      serverTime: room.server_time,
      deadline: room.reveal_ends_at,
      durationSeconds: 3,
    };
  if (state === "battle" || state === "forced_switch")
    return {
      serverTime: room.server_time,
      deadline: room.phase_deadline,
      durationSeconds: 15,
    };
  return { serverTime: null, deadline: null, durationSeconds: null };
}

function realtimePhaseFor(
  state: BattlePageState,
  room: BattleRoomSnapshotDto | null,
): Parameters<typeof useBattleRealtime>[0]["phase"] {
  if (state === "accept") return "accept";
  if (state === "preparing_share") return "preparing_share";
  if (state === "waiting") return "waiting";
  if (state === "lobby") return "lobby";
  if (state === "forced_switch") return "forced_switch";
  if (state === "battle")
    return room?.status === "reveal" ? "reveal" : "active_select";
  return "idle";
}

function isInviteRoom(invite: Invite | undefined): invite is InviteRoom {
  return Boolean(invite && "room_id" in invite);
}

function parseSelection(
  slots: BattleTeamSlots,
  items: RouteOutput<"battle.team_options">["items"],
): BattleTeamSelection | null {
  const parsed = battleTeamSelectionSchema.safeParse(slots);
  return parsed.success &&
    parsed.data.every((templateId) =>
      items.some(
        (item) =>
          item.template_id === templateId && item.available_quantity > 0,
      ),
    )
    ? parsed.data
    : null;
}

function compareSnapshots(
  left: BattleRoomSnapshotDto,
  right: BattleRoomSnapshotDto,
): number {
  if (left.state_version !== right.state_version)
    return left.state_version - right.state_version;
  return Date.parse(left.server_time) - Date.parse(right.server_time);
}

function presenceLifecycleFor(
  snapshot: BattleRoomSnapshotDto,
  current: PresenceLifecycle | null,
): PresenceLifecycle {
  const authority = snapshot.presence_lifecycle;
  if (
    current &&
    current.roomId === snapshot.room_id &&
    !current.ended &&
    (current.version === authority.version + 1 ||
      (current.version === authority.version &&
        current.leaseId === authority.lease_id &&
        authority.active))
  )
    return current;
  return {
    roomId: snapshot.room_id,
    leaseId: crypto.randomUUID(),
    version: authority.version + 1,
    nextCommandSeq: 0,
    ended: false,
  };
}

async function applyPresenceFailureScopes(cause: unknown): Promise<void> {
  if (!(cause instanceof ApiFailure) || !isErrorCode(cause.code)) return;
  const declared = errorDefinition(cause.code).refreshScope;
  const scopes: readonly RefreshScope[] =
    typeof declared === "string" ? [declared] : declared;
  await refreshScopes(scopes).catch(() => undefined);
}

function terminalObservationsFor({
  rooms,
  participations,
}: {
  rooms: readonly (BattleRoomSnapshotDto | null | undefined)[];
  participations: readonly (
    | RouteOutput<"battle.bootstrap">["participation"]
    | undefined
  )[];
}): BattleTerminalObservation[] {
  return [
    ...rooms.map((room) =>
      room && isBattleAssetTerminal(room.status)
        ? { roomId: room.room_id, stateVersion: room.state_version }
        : null,
    ),
    ...participations.map((participation) =>
      participation && isBattleAssetTerminal(participation.status)
        ? {
            roomId: participation.room_id,
            stateVersion: participation.state_version,
          }
        : null,
    ),
  ]
    .filter(
      (observation): observation is BattleTerminalObservation =>
        observation !== null,
    )
    .filter(
      (observation, index, observations) =>
        observations.findIndex(
          (candidate) =>
            candidate.roomId === observation.roomId &&
            candidate.stateVersion === observation.stateVersion,
        ) === index,
    )
    .sort(
      (left, right) =>
        left.roomId.localeCompare(right.roomId) ||
        left.stateVersion - right.stateVersion,
    );
}

function shareFailureText(failure: TelegramShareFailure): string {
  const messages: Record<TelegramShareFailure, string> = {
    UNSUPPORTED: "当前 Telegram 版本不支持发送挑战卡，请更新后重试",
    MESSAGE_EXPIRED: "挑战卡已失效，正在重新读取房间状态",
    MESSAGE_SEND_FAILED: "挑战卡发送失败，房间继续等待，可再次分享",
    USER_DECLINED: "已关闭分享面板，房间继续等待，可再次分享",
    UNKNOWN_ERROR: "挑战卡未发送，房间继续等待，可再次分享",
  };
  return messages[failure];
}
