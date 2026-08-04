import { randomUUID } from "node:crypto";

import * as Ably from "ably";
import { z } from "zod";
import type { BattleRealtimeInvalidation } from "@pokepets/api-contracts/app";

import { ApiError } from "../../http/errors.ts";
import { rpc } from "../../platform/db/index.ts";
import { getBattleEnv } from "../../platform/env/index.ts";
import {
  observeRequestStage,
  type RequestTelemetry,
} from "../../platform/observability/index.ts";

type RealtimeContext = {
  user_id: string;
  user_channel: string;
  room_channel: string | null;
  invite_channel: string | null;
};

type OutboxLease = BattleRealtimeInvalidation & {
  outbox_id: string;
  attempt_count: number;
  channels: string[];
};

export type OutboxDelivery = {
  processed: number;
  published: number;
  deferred: number;
};

let client: Ably.Rest | undefined;
const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuidValuePattern = new RegExp(`^${uuidPattern}$`, "i");
const userChannelPattern = new RegExp(`^battle:user:${uuidPattern}$`, "i");
const roomChannelPattern = new RegExp(`^battle:room:${uuidPattern}$`, "i");
const inviteChannelPattern = /^battle:invite:[0-9a-f]{64}$/;
const ablyCapabilitySchema = z.record(z.string(), z.array(z.string()));

function ably(): Ably.Rest {
  const env = getBattleEnv();
  client ??= new Ably.Rest({
    key: env.ABLY_API_KEY,
    logLevel: 0,
    httpRequestTimeout: 5_000,
  });
  return client;
}

export async function issueBattleRealtimeToken(
  sessionId: string,
  signal?: AbortSignal,
  telemetry?: RequestTelemetry | null,
): Promise<{
  token: string;
  keyName: string;
  issued: number;
  expires: number;
  capability: string;
  clientId: string;
}> {
  const env = getBattleEnv();
  const realtime = ably();
  const context = await rpc<RealtimeContext>(
    "battle_realtime_context",
    { p_session_id: sessionId },
    { signal, telemetry },
  );
  const channels = [
    context.user_channel,
    context.room_channel,
    context.invite_channel,
  ].filter((channel): channel is string => channel !== null);
  if (
    !userChannelPattern.test(context.user_channel) ||
    context.user_channel !== `battle:user:${context.user_id}` ||
    (context.room_channel !== null &&
      !roomChannelPattern.test(context.room_channel)) ||
    (context.invite_channel !== null &&
      !inviteChannelPattern.test(context.invite_channel))
  )
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Battle 实时权限上下文无效",
      true,
    );
  const clientId = `battle-user:${context.user_id}`;
  const expectedChannels = [...new Set(channels)].sort();
  const details = await observeRequestStage(telemetry, "ably", () =>
    realtime.auth.requestToken({
      clientId,
      ttl: 300_000,
      capability: Object.fromEntries(
        expectedChannels.map((channel) => [channel, ["subscribe"]]),
      ),
    }),
  );
  if (
    !details.token ||
    details.clientId !== clientId ||
    !Number.isSafeInteger(details.issued) ||
    !Number.isSafeInteger(details.expires) ||
    details.issued <= 0 ||
    details.expires - details.issued !== 300_000 ||
    !capabilityMatches(details.capability, expectedChannels)
  )
    throw new ApiError(502, "INTERNAL_ERROR", "Battle 实时令牌无效", true);
  const keyName = env.ABLY_API_KEY.split(":", 1)[0]!;
  return {
    token: details.token,
    keyName,
    issued: details.issued,
    expires: details.expires,
    capability: details.capability,
    clientId: details.clientId,
  };
}

function capabilityMatches(
  capability: string,
  expectedChannels: readonly string[],
): boolean {
  try {
    const parsed = ablyCapabilitySchema.safeParse(JSON.parse(capability));
    if (!parsed.success) return false;
    const actualChannels = Object.keys(parsed.data).sort();
    return (
      actualChannels.length === expectedChannels.length &&
      actualChannels.every(
        (channel, index) =>
          channel === expectedChannels[index] &&
          parsed.data[channel]?.length === 1 &&
          parsed.data[channel][0] === "subscribe",
      )
    );
  } catch {
    return false;
  }
}

export async function deliverBattleOutbox(
  signal?: AbortSignal,
  limit = 10,
  telemetry?: RequestTelemetry | null,
): Promise<OutboxDelivery> {
  if (signal?.aborted) throw signal.reason;
  ably();
  const leaseOwner = randomUUID();
  const events = await rpc<OutboxLease[]>(
    "battle_claim_outbox",
    { p_lease_owner: leaseOwner, p_limit: limit },
    { signal, telemetry },
  );
  const result: OutboxDelivery = {
    processed: events.length,
    published: 0,
    deferred: 0,
  };
  const outcomes = await Promise.all(
    events.map((event) => deliverOne(event, leaseOwner, signal, telemetry)),
  );
  for (const outcome of outcomes) {
    result[outcome] += 1;
  }
  return result;
}

async function deliverOne(
  event: OutboxLease,
  leaseOwner: string,
  signal?: AbortSignal,
  telemetry?: RequestTelemetry | null,
): Promise<"published" | "deferred"> {
  if (signal?.aborted) throw signal.reason;
  if (!validOutboxLease(event)) {
    await complete(
      event.outbox_id,
      leaseOwner,
      false,
      "OUTBOX_INVALID",
      telemetry,
    );
    return "deferred";
  }
  const payload: BattleRealtimeInvalidation = {
    event_id: event.event_id,
    room_id: event.room_id,
    state_version: event.state_version,
    event_kind: event.event_kind,
  };
  try {
    await observeRequestStage(telemetry, "ably", () =>
      Promise.all(
        event.channels.map((channel) =>
          ably().channels.get(channel).publish("battle.invalidate", payload),
        ),
      ),
    );
    const acknowledged = await complete(
      event.outbox_id,
      leaseOwner,
      true,
      null,
      telemetry,
    );
    if (!acknowledged) throw new Error("Outbox lease acknowledgement failed");
    return "published";
  } catch {
    await complete(
      event.outbox_id,
      leaseOwner,
      false,
      "ABLY_PUBLISH_FAILED",
      telemetry,
    );
    return "deferred";
  }
}

async function complete(
  outboxId: string,
  leaseOwner: string,
  success: boolean,
  errorCode: string | null,
  telemetry?: RequestTelemetry | null,
): Promise<boolean> {
  return rpc<boolean>(
    "battle_complete_outbox",
    {
      p_outbox_id: outboxId,
      p_lease_owner: leaseOwner,
      p_success: success,
      p_error_code: errorCode,
    },
    { telemetry },
  );
}

function validOutboxLease(event: OutboxLease): boolean {
  return (
    uuidValuePattern.test(event.outbox_id) &&
    uuidValuePattern.test(event.event_id) &&
    uuidValuePattern.test(event.room_id) &&
    Number.isSafeInteger(event.state_version) &&
    event.state_version > 0 &&
    /^[A-Za-z0-9_.-]{1,128}$/.test(event.event_kind) &&
    event.channels.length > 0 &&
    event.channels.every(
      (channel) =>
        userChannelPattern.test(channel) ||
        roomChannelPattern.test(channel) ||
        inviteChannelPattern.test(channel),
    )
  );
}
