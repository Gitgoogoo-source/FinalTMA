import * as Ably from "ably";

export type BattleRealtimeRuntimeStatus =
  | "connecting"
  | "connected"
  | "offline";

export type BattleRealtimeRuntimeConnection = {
  reconnectIfFailed(): void;
  close(): void;
};

export type BattleRealtimeRuntimeOptions = {
  tokenDetails: unknown;
  authorizedChannels: readonly string[];
  refreshToken(): Promise<unknown>;
  validateRefreshedAuthorization(
    tokenDetails: unknown,
  ): readonly string[] | null;
  onMessage(data: unknown): void;
  onStatus(status: BattleRealtimeRuntimeStatus): void;
};

type BattleRealtimeDiagnosticStage =
  | "token_refresh_invalid"
  | "token_refresh_failed"
  | "connection_unavailable"
  | "channel_attach_failed";

export function connectBattleRealtimeRuntime({
  tokenDetails,
  authorizedChannels,
  refreshToken,
  validateRefreshedAuthorization,
  onMessage,
  onStatus,
}: BattleRealtimeRuntimeOptions): BattleRealtimeRuntimeConnection {
  let disposed = false;
  let pendingAuthorizedChannels: readonly string[] | null = null;
  const channels = new Map<string, Ably.RealtimeChannel>();
  const handleMessage = (message: Ably.InboundMessage) => {
    onMessage(message.data);
  };
  const client = new Ably.Realtime({
    tokenDetails: tokenDetails as Ably.TokenDetails,
    autoConnect: false,
    logLevel: 0,
    authCallback: (_params, callback) => {
      void refreshToken()
        .then((refreshed) => {
          if (disposed) return;
          const nextAuthorizedChannels =
            validateRefreshedAuthorization(refreshed);
          if (!nextAuthorizedChannels) {
            onStatus("offline");
            reportBattleRealtimeDiagnostic("token_refresh_invalid");
            callback("BATTLE_REALTIME_CAPABILITY_INVALID", null);
            return;
          }
          pendingAuthorizedChannels = [...nextAuthorizedChannels];
          callback(null, refreshed as Ably.TokenDetails);
        })
        .catch((cause: unknown) => {
          if (disposed) return;
          reportBattleRealtimeDiagnostic("token_refresh_failed", cause);
          callback(
            cause instanceof Error
              ? cause.message
              : "BATTLE_REALTIME_TOKEN_FAILED",
            null,
          );
        });
    },
  });

  const synchronizeChannels = (nextChannelNames: readonly string[]) => {
    const nextNames = new Set(nextChannelNames);
    for (const name of nextNames) {
      if (channels.has(name)) continue;
      const channel = client.channels.get(name);
      channels.set(name, channel);
      void channel.subscribe(handleMessage).catch((cause: unknown) => {
        if (!disposed) {
          reportBattleRealtimeDiagnostic("channel_attach_failed", cause);
          onStatus("offline");
        }
      });
    }
    for (const [name, channel] of channels) {
      if (nextNames.has(name)) continue;
      channel.unsubscribe(handleMessage);
      channels.delete(name);
      void channel.detach().catch(() => undefined);
    }
  };
  const applyPendingAuthorization = () => {
    if (!pendingAuthorizedChannels) return;
    const nextAuthorizedChannels = pendingAuthorizedChannels;
    pendingAuthorizedChannels = null;
    synchronizeChannels(nextAuthorizedChannels);
  };
  const handleConnectionState = (change: Ably.ConnectionStateChange) => {
    if (disposed) return;
    if (change.current === "connected") {
      applyPendingAuthorization();
      onStatus("connected");
    } else if (
      change.current === "disconnected" ||
      change.current === "suspended" ||
      change.current === "failed"
    ) {
      reportBattleRealtimeDiagnostic(
        "connection_unavailable",
        change.reason,
        change.current,
      );
      onStatus("offline");
    } else if (
      change.current === "initialized" ||
      change.current === "connecting"
    )
      onStatus("connecting");
  };
  const handleConnectionUpdate = () => {
    if (!disposed) applyPendingAuthorization();
  };

  client.connection.on(handleConnectionState);
  client.connection.on("update", handleConnectionUpdate);
  synchronizeChannels(authorizedChannels);
  client.connect();

  return {
    reconnectIfFailed() {
      if (!disposed && client.connection.state === "failed") client.connect();
    },
    close() {
      if (disposed) return;
      disposed = true;
      client.connection.off(handleConnectionState);
      client.connection.off("update", handleConnectionUpdate);
      for (const channel of channels.values()) {
        channel.unsubscribe(handleMessage);
        void channel.detach().catch(() => undefined);
      }
      channels.clear();
      client.close();
    },
  };
}

function reportBattleRealtimeDiagnostic(
  stage: BattleRealtimeDiagnosticStage,
  cause?: unknown,
  connectionState?: Ably.ConnectionState,
): void {
  const error = isAblyErrorShape(cause) ? cause : null;
  console.warn("battle_realtime_unavailable", {
    stage,
    connection_state: connectionState ?? null,
    code: safeDiagnosticInteger(error?.code),
    status_code: safeDiagnosticInteger(error?.statusCode),
  });
}

function isAblyErrorShape(
  value: unknown,
): value is { code?: unknown; statusCode?: unknown } {
  return typeof value === "object" && value !== null;
}

function safeDiagnosticInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}
