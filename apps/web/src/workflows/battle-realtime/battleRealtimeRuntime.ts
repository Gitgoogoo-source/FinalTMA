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
  validateRefreshedToken(tokenDetails: unknown): boolean;
  onMessage(data: unknown): void;
  onStatus(status: BattleRealtimeRuntimeStatus): void;
};

export function connectBattleRealtimeRuntime({
  tokenDetails,
  authorizedChannels,
  refreshToken,
  validateRefreshedToken,
  onMessage,
  onStatus,
}: BattleRealtimeRuntimeOptions): BattleRealtimeRuntimeConnection {
  let disposed = false;
  const channels: Ably.RealtimeChannel[] = [];
  const client = new Ably.Realtime({
    tokenDetails: tokenDetails as Ably.TokenDetails,
    autoConnect: false,
    logLevel: 0,
    authCallback: (_params, callback) => {
      void refreshToken()
        .then((refreshed) => {
          if (disposed) return;
          if (!validateRefreshedToken(refreshed)) {
            onStatus("offline");
            callback("BATTLE_REALTIME_CAPABILITY_INVALID", null);
            return;
          }
          callback(null, refreshed as Ably.TokenDetails);
        })
        .catch((cause: unknown) => {
          if (disposed) return;
          callback(
            cause instanceof Error
              ? cause.message
              : "BATTLE_REALTIME_TOKEN_FAILED",
            null,
          );
        });
    },
  });

  const handleMessage = (message: Ably.InboundMessage) => {
    onMessage(message.data);
  };
  const handleConnectionState = (change: Ably.ConnectionStateChange) => {
    if (disposed) return;
    if (change.current === "connected") onStatus("connected");
    else if (
      change.current === "disconnected" ||
      change.current === "suspended" ||
      change.current === "failed"
    )
      onStatus("offline");
    else if (
      change.current === "initialized" ||
      change.current === "connecting"
    )
      onStatus("connecting");
  };

  client.connection.on(handleConnectionState);
  for (const name of authorizedChannels) {
    const channel = client.channels.get(name);
    channels.push(channel);
    void channel.subscribe(handleMessage).catch(() => {
      if (!disposed) onStatus("offline");
    });
  }
  client.connect();

  return {
    reconnectIfFailed() {
      if (!disposed && client.connection.state === "failed") client.connect();
    },
    close() {
      if (disposed) return;
      disposed = true;
      client.connection.off(handleConnectionState);
      for (const channel of channels) {
        channel.unsubscribe(handleMessage);
        void channel.detach().catch(() => undefined);
      }
      client.close();
    },
  };
}
