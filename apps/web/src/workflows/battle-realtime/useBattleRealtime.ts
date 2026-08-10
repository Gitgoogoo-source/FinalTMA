import { useCallback, useEffect, useRef, useState } from "react";
import { parseBattleRealtimeInvalidation } from "@pokepets/api-contracts/app-client";

import { apiRequest } from "../../platform/api/client.ts";
import { loadBattleRealtimeRuntime } from "./battleRealtimeRuntimeLoader.ts";

const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const battleChannelPatterns = [
  new RegExp(`^battle:user:${uuidPattern}$`, "i"),
  new RegExp(`^battle:room:${uuidPattern}$`, "i"),
  /^battle:invite:[0-9a-f]{64}$/,
] as const;

export type BattleRealtimePhase =
  | "idle"
  | "preparing_share"
  | "waiting"
  | "lobby"
  | "accept"
  | "active_turn";

export type BattleRealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "offline";

type RuntimeConnection = {
  reconnectIfFailed(): void;
  close(): void;
};

export function useBattleRealtime({
  enabled,
  pageActive,
  contextKey,
  phase,
  stateVersion,
  refetch,
}: {
  enabled: boolean;
  pageActive: boolean;
  contextKey: string;
  phase: BattleRealtimePhase;
  stateVersion: number;
  refetch(): Promise<void>;
}): BattleRealtimeStatus {
  const [status, setStatus] = useState<BattleRealtimeStatus>(
    enabled ? "connecting" : "idle",
  );
  const connectionRef = useRef<RuntimeConnection | null>(null);
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const versionRef = useRef(stateVersion);
  const refetchRef = useRef(refetch);
  const seenEvents = useRef(new Set<string>());
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    versionRef.current = stateVersion;
    refetchRef.current = refetch;
  }, [refetch, stateVersion]);

  useEffect(() => {
    if (!enabled) return;
    const initialController = new AbortController();
    const authControllers = new Set<AbortController>();
    let disposed = false;
    let connectInFlight = false;
    let refreshTimer: number | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;

    const runRefetch = async () => {
      if (disposed || !pageActive || document.visibilityState !== "visible")
        return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        await refetchRef.current();
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          scheduleRef.current?.();
        }
      }
    };
    const scheduleRefetch = () => {
      if (disposed || !pageActive || document.visibilityState !== "visible")
        return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void runRefetch();
      }, 80);
    };
    scheduleRef.current = scheduleRefetch;
    const onMessage = (data: unknown) => {
      void parseBattleRealtimeInvalidation(data)
        .then((parsed) => {
          if (
            parsed.state_version < versionRef.current ||
            seenEvents.current.has(parsed.event_id)
          )
            return;
          seenEvents.current.add(parsed.event_id);
          if (seenEvents.current.size > 128) {
            const oldest = seenEvents.current.values().next().value;
            if (oldest) seenEvents.current.delete(oldest);
          }
          scheduleRefetch();
        })
        .catch(() => undefined);
    };
    const connect = async () => {
      if (disposed || connectInFlight || connectionRef.current) return;
      connectInFlight = true;
      setStatus("connecting");
      try {
        const tokenPromise = apiRequest(
          "battle.realtime_token",
          {},
          { signal: initialController.signal },
        );
        const runtimePromise = loadBattleRealtimeRuntime();
        const [token, runtime] = await Promise.all([
          tokenPromise,
          runtimePromise,
        ]);
        if (disposed) return;
        const authorization = parseBattleRealtimeAuthorization(token.data);
        if (!authorization)
          throw new Error("BATTLE_REALTIME_CAPABILITY_INVALID");
        connectionRef.current = runtime.connectBattleRealtimeRuntime({
          tokenDetails: token.data,
          authorizedChannels: authorization.channels,
          refreshToken: async () => {
            const controller = new AbortController();
            authControllers.add(controller);
            try {
              return (
                await apiRequest(
                  "battle.realtime_token",
                  {},
                  { signal: controller.signal },
                )
              ).data;
            } finally {
              authControllers.delete(controller);
            }
          },
          validateRefreshedAuthorization: (tokenDetails) => {
            const refreshed = parseBattleRealtimeAuthorization(tokenDetails);
            if (
              !refreshed ||
              refreshed.clientId !== authorization.clientId ||
              refreshed.userChannel !== authorization.userChannel
            )
              return null;
            return refreshed.channels;
          },
          onMessage,
          onStatus: (next) => {
            if (disposed) return;
            setStatus(next);
            if (next === "connected") scheduleRefetch();
          },
        });
      } catch {
        if (!disposed) setStatus("offline");
      } finally {
        connectInFlight = false;
      }
    };
    connectRef.current = connect;
    void connect();
    return () => {
      disposed = true;
      initialController.abort();
      authControllers.forEach((controller) => controller.abort());
      authControllers.clear();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      scheduleRef.current = null;
      if (connectRef.current === connect) connectRef.current = null;
      const connection = connectionRef.current;
      connection?.close();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [contextKey, enabled, pageActive]);

  const poll = useCallback(() => {
    scheduleRef.current?.();
  }, []);
  useEffect(() => {
    const interval = pollingInterval(phase);
    if (
      !enabled ||
      !pageActive ||
      interval === null ||
      status === "connected" ||
      document.visibilityState !== "visible"
    )
      return;
    const timer = window.setInterval(poll, interval);
    return () => window.clearInterval(timer);
  }, [enabled, pageActive, phase, poll, status]);

  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => {
      scheduleRef.current?.();
      const connection = connectionRef.current;
      if (connection) connection.reconnectIfFailed();
      else void connectRef.current?.();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled]);

  return enabled ? status : "idle";
}

function pollingInterval(phase: BattleRealtimePhase): 1_000 | 2_000 | null {
  if (phase === "active_turn") return 1_000;
  if (
    phase === "waiting" ||
    phase === "lobby" ||
    phase === "accept" ||
    phase === "preparing_share"
  )
    return 2_000;
  return null;
}

function parseAuthorizedChannels(capability: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(capability);
    if (!isRecord(parsed)) return null;
    const channels: string[] = [];
    for (const [channel, operations] of Object.entries(parsed)) {
      if (
        hasWildcardSyntax(channel) ||
        !battleChannelPatterns.some((pattern) => pattern.test(channel)) ||
        !Array.isArray(operations) ||
        operations.length !== 1 ||
        operations[0] !== "subscribe"
      )
        return null;
      channels.push(channel);
    }
    return [...new Set(channels)].sort();
  } catch {
    return null;
  }
}

function parseBattleRealtimeAuthorization(tokenDetails: unknown): {
  channels: string[];
  clientId: string;
  userChannel: string;
} | null {
  const capability = tokenCapability(tokenDetails);
  const clientId = tokenClientId(tokenDetails);
  if (!capability || !clientId) return null;
  const channels = parseAuthorizedChannels(capability);
  if (!channels || channels.length === 0) return null;
  const userChannels = channels.filter((channel) =>
    battleChannelPatterns[0].test(channel),
  );
  const roomChannels = channels.filter((channel) =>
    battleChannelPatterns[1].test(channel),
  );
  const inviteChannels = channels.filter((channel) =>
    battleChannelPatterns[2].test(channel),
  );
  if (
    userChannels.length !== 1 ||
    roomChannels.length > 1 ||
    inviteChannels.length > 1
  )
    return null;
  const userChannel = userChannels[0]!;
  if (clientId !== `battle-user:${userChannel.slice("battle:user:".length)}`)
    return null;
  return { channels, clientId, userChannel };
}

function hasWildcardSyntax(channel: string): boolean {
  return ["*", "?", "[", "]", "{", "}", "#", ">"].some((marker) =>
    channel.includes(marker),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCapability(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.capability === "string" ? value.capability : null;
}

function tokenClientId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.clientId === "string" ? value.clientId : null;
}
