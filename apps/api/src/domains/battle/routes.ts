import { randomUUID } from "node:crypto";

import {
  operationResult,
  type OperationEnvelope,
} from "../../http/operation-result.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../../http/handlers.ts";
import { rpc } from "../../platform/db/index.ts";
import {
  deliverBattleOutbox,
  issueBattleRealtimeToken,
} from "../../workflows/battle-outbox/ably.ts";
import {
  battleInviteToken,
  battleInviteTokenHash,
} from "../../workflows/battle-share/invite.ts";
import { deliverPreparedBattleShares } from "../../workflows/battle-share/process.ts";

export const battleHandlers = {
  "battle.bootstrap": async (context) => ({
    data: await rpc(
      "battle_bootstrap",
      { p_session_id: requireSession(context).session_id },
      { signal: requestSignal(context.request) },
    ),
  }),
  "battle.team_options": async (context) => ({
    data: await rpc(
      "battle_team_options",
      { p_session_id: requireSession(context).session_id },
      { signal: requestSignal(context.request) },
    ),
  }),
  "battle.current_invite": async (context) => ({
    data: await rpc(
      "battle_current_invite",
      { p_session_id: requireSession(context).session_id },
      { signal: requestSignal(context.request) },
    ),
  }),
  "battle.room": async (context) => ({
    data: await rpc(
      "battle_room",
      {
        p_session_id: requireSession(context).session_id,
        p_room_id: context.input.room_id,
      },
      { signal: requestSignal(context.request) },
    ),
  }),
  "battle.create": async (context) => {
    const session = requireSession(context);
    const operationId = requireOperationId(context);
    const token = battleInviteToken(operationId);
    const signal = requestSignal(context.request);
    const operation = await rpc<OperationEnvelope>(
      "battle_prepare_room",
      {
        p_session_id: session.session_id,
        p_operation_id: operationId,
        p_room_id: randomUUID(),
        p_invite_token_hash: battleInviteTokenHash(token),
        p_entry_tier_id: context.input.tier,
        p_template_ids: context.input.template_ids,
      },
      { signal },
    );
    const initial = operationResult(operation, {
      operationId,
      useCase: "battle.create",
    });
    if (operation.status === "succeeded") return initial;
    if (operation.status !== "pending")
      throw new Error("Battle create operation has an invalid state");
    await deliverPreparedBattleShares(signal, {
      limit: 1,
      roomId: pendingRoomId(operation),
    });
    await deliverBattleOutbox(signal, 10);
    return operationResult(
      await rpc<OperationEnvelope>(
        "operations_get",
        {
          p_session_id: session.session_id,
          p_operation_id: operationId,
        },
        { signal },
      ),
      { operationId, useCase: "battle.create" },
    );
  },
  "battle.cancel": async (context) =>
    command(context, "battle.cancel", "battle_cancel_room", {
      p_room_id: context.input.room_id,
    }),
  "battle.accept": async (context) =>
    command(context, "battle.accept", "battle_accept_room", {
      p_template_ids: context.input.template_ids,
    }),
  "battle.action": async (context) =>
    command(context, "battle.action", "battle_submit_action", {
      p_room_id: context.input.room_id,
      p_turn_no: context.input.turn_no,
      p_kind: context.input.kind,
      p_skill_position:
        context.input.kind === "attack" ? context.input.skill_position : null,
      p_target_slot:
        context.input.kind === "switch" ? context.input.team_slot : null,
    }),
  "battle.forced_switch": async (context) =>
    command(context, "battle.forced_switch", "battle_submit_forced_switch", {
      p_room_id: context.input.room_id,
      p_turn_no: context.input.turn_no,
      p_target_slot: context.input.team_slot,
    }),
  "battle.heartbeat": async (context) =>
    nonOperationCommand(
      context,
      "battle_heartbeat",
      { p_room_id: context.input.room_id },
      false,
    ),
  "battle.offline": async (context) =>
    nonOperationCommand(context, "battle_mark_offline", {
      p_room_id: context.input.room_id,
    }),
  "battle.acknowledge_result": async (context) =>
    nonOperationCommand(context, "battle_acknowledge_result", {
      p_room_id: context.input.room_id,
    }),
  "battle.realtime_token": async (context) => ({
    data: await issueBattleRealtimeToken(
      requireSession(context).session_id,
      requestSignal(context.request),
    ),
  }),
} satisfies HandlerMap;

async function command(
  context: Parameters<HandlerMap[string]>[0],
  useCase: string,
  rpcName: string,
  parameters: Record<string, unknown>,
) {
  const signal = requestSignal(context.request);
  const operationId = requireOperationId(context);
  const result = operationResult(
    await rpc<OperationEnvelope>(
      rpcName,
      {
        p_session_id: requireSession(context).session_id,
        p_operation_id: operationId,
        ...parameters,
      },
      { signal },
    ),
    { operationId, useCase },
  );
  await deliverBattleOutbox(signal, 10);
  return result;
}

async function nonOperationCommand(
  context: Parameters<HandlerMap[string]>[0],
  rpcName: string,
  parameters: Record<string, unknown>,
  publishOutbox = true,
) {
  const signal = requestSignal(context.request);
  const data = await rpc(
    rpcName,
    {
      p_session_id: requireSession(context).session_id,
      ...parameters,
    },
    { signal },
  );
  if (publishOutbox) await deliverBattleOutbox(signal, 10);
  return { data };
}

function requestSignal(request: Request): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
}

function pendingRoomId(operation: OperationEnvelope): string {
  if (
    !operation.result ||
    typeof operation.result !== "object" ||
    !("room_id" in operation.result) ||
    typeof operation.result.room_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      operation.result.room_id,
    )
  )
    throw new Error("Battle create operation has no room context");
  return operation.result.room_id;
}
