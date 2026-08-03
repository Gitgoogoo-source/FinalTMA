import { useCallback, useEffect, useRef, useState } from "react";
import * as Ably from "ably";
import { battleRealtimeInvalidationSchema } from "@pokepets/api-contracts/app";

import { apiRequest } from "../../platform/api/client.ts";

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
  const clientRef = useRef<Ably.Realtime | null>(null);
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
    const channels: Ably.RealtimeChannel[] = [];
    let disposed = false;
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
    const onMessage = (message: Ably.InboundMessage) => {
      const parsed = battleRealtimeInvalidationSchema.safeParse(message.data);
      if (
        !parsed.success ||
        parsed.data.state_version < versionRef.current ||
        seenEvents.current.has(parsed.data.event_id)
      )
        return;
      seenEvents.current.add(parsed.data.event_id);
      if (seenEvents.current.size > 128) {
        const oldest = seenEvents.current.values().next().value;
        if (oldest) seenEvents.current.delete(oldest);
      }
      scheduleRefetch();
    };
    const onConnectionState = (change: Ably.ConnectionStateChange) => {
      if (disposed) return;
      if (change.current === "connected") {
        setStatus("connected");
        scheduleRefetch();
      } else if (
        change.current === "disconnected" ||
        change.current === "suspended" ||
        change.current === "failed"
      ) {
        setStatus("offline");
      } else if (
        change.current === "initialized" ||
        change.current === "connecting"
      ) {
        setStatus("connecting");
      }
    };
    const connect = async () => {
      try {
        const token = await apiRequest(
          "battle.realtime_token",
          {},
          { signal: initialController.signal },
        );
        if (disposed) return;
        const authorized = parseAuthorizedChannels(token.data.capability);
        if (!authorized || authorized.length === 0)
          throw new Error("BATTLE_REALTIME_CAPABILITY_INVALID");
        const tokenDetails: Ably.TokenDetails = token.data;
        const client = new Ably.Realtime({
          tokenDetails,
          autoConnect: false,
          logLevel: 0,
          authCallback: (_params, callback) => {
            const controller = new AbortController();
            authControllers.add(controller);
            void apiRequest(
              "battle.realtime_token",
              {},
              { signal: controller.signal },
            )
              .then((result) => {
                if (disposed) return;
                const refreshed = parseAuthorizedChannels(
                  result.data.capability,
                );
                if (!refreshed || !sameChannels(refreshed, authorized)) {
                  setStatus("offline");
                  callback("BATTLE_REALTIME_CAPABILITY_INVALID", null);
                  return;
                }
                callback(null, result.data);
              })
              .catch((cause: unknown) => {
                if (!disposed)
                  callback(
                    cause instanceof Error
                      ? cause.message
                      : "BATTLE_REALTIME_TOKEN_FAILED",
                    null,
                  );
              })
              .finally(() => authControllers.delete(controller));
          },
        });
        clientRef.current = client;
        client.connection.on(onConnectionState);
        for (const name of authorized) {
          const channel = client.channels.get(name);
          channels.push(channel);
          void channel.subscribe(onMessage).catch(() => {
            if (!disposed) setStatus("offline");
          });
        }
        client.connect();
      } catch {
        if (!disposed) setStatus("offline");
      }
    };
    void connect();
    return () => {
      disposed = true;
      initialController.abort();
      authControllers.forEach((controller) => controller.abort());
      authControllers.clear();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      scheduleRef.current = null;
      const client = clientRef.current;
      if (client) {
        client.connection.off(onConnectionState);
        for (const channel of channels) {
          channel.unsubscribe(onMessage);
          void channel.detach().catch(() => undefined);
        }
        client.close();
      }
      if (clientRef.current === client) clientRef.current = null;
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
      status !== "offline" ||
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
      const client = clientRef.current;
      if (client?.connection.state === "failed") client.connect();
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

function hasWildcardSyntax(channel: string): boolean {
  return ["*", "?", "[", "]", "{", "}", "#", ">"].some((marker) =>
    channel.includes(marker),
  );
}

function sameChannels(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((channel, index) => channel === right[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
