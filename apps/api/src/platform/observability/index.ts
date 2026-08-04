export type RequestStage =
  | "auth"
  | "input_parse"
  | "handler"
  | "response"
  | "db_rpc"
  | "ably";

type OutboxDeliveryCounts = {
  processed: number;
  published: number;
  deferred: number;
};

export type RequestTelemetry = {
  measure<T>(stage: RequestStage, operation: () => Promise<T>): Promise<T>;
  measureSync<T>(stage: RequestStage, operation: () => T): T;
  recordOutbox(delivery: OutboxDeliveryCounts): void;
  snapshot(): Readonly<Record<string, string | number>>;
};

export function createBattleRequestTelemetry(): RequestTelemetry {
  const durations: Partial<Record<RequestStage, number>> = {};
  const counts: Partial<Record<"db_rpc" | "ably", number>> = {};
  let outbox: OutboxDeliveryCounts | null = null;

  const recordDuration = (stage: RequestStage, startedAt: number): void => {
    durations[stage] =
      (durations[stage] ?? 0) + Math.max(0, performance.now() - startedAt);
    if (stage === "db_rpc" || stage === "ably")
      counts[stage] = (counts[stage] ?? 0) + 1;
  };

  return {
    async measure(stage, operation) {
      const startedAt = performance.now();
      try {
        return await operation();
      } finally {
        recordDuration(stage, startedAt);
      }
    },
    measureSync(stage, operation) {
      const startedAt = performance.now();
      try {
        return operation();
      } finally {
        recordDuration(stage, startedAt);
      }
    },
    recordOutbox(delivery) {
      if (
        Object.values(delivery).every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        )
      )
        outbox = { ...delivery };
    },
    snapshot() {
      return {
        telemetry_scope: "battle",
        ...Object.fromEntries(
          Object.entries(durations).map(([stage, duration]) => [
            `${stage}_ms`,
            Math.round(duration),
          ]),
        ),
        ...(counts.db_rpc === undefined ? {} : { db_rpc_count: counts.db_rpc }),
        ...(counts.ably === undefined
          ? {}
          : { ably_operation_count: counts.ably }),
        ...(outbox
          ? {
              outbox_processed: outbox.processed,
              outbox_published: outbox.published,
              outbox_deferred: outbox.deferred,
            }
          : {}),
      };
    },
  };
}

export function observesBattleRoute(routeId: string): boolean {
  return (
    routeId === "battle.outbox_integration" ||
    (routeId.startsWith("battle.") && routeId !== "battle.share_integration")
  );
}

export function observeRequestStage<T>(
  telemetry: RequestTelemetry | null | undefined,
  stage: RequestStage,
  operation: () => Promise<T>,
): Promise<T> {
  return telemetry ? telemetry.measure(stage, operation) : operation();
}

export function observeRequestStageSync<T>(
  telemetry: RequestTelemetry | null | undefined,
  stage: RequestStage,
  operation: () => T,
): T {
  return telemetry ? telemetry.measureSync(stage, operation) : operation();
}
