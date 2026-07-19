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
import { signMintPermit, type MintPermit } from "../../platform/ton/permit.ts";

type Reservation = {
  mint: { id: string; template_id: string; nft_number: number };
  receiver: string;
  permit_payload: {
    mint_id: string;
    nft_number: number;
    nonce: string;
    receiver: string;
    template_id: string;
    valid_until: string;
  };
  valid_until: string;
};

export const mintHandlers = {
  "mint.list": async (context) => ({
    data: await rpc("mint_list", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "mint.get": async (context) => ({
    data: await rpc("mint_get", {
      p_session_id: requireSession(context).session_id,
      p_mint_id: context.input.mint_id,
    }),
  }),
  "mint.metadata": async (context) => ({
    data: await rpc("mint_metadata", { p_nft_id: context.input.nft_id }),
  }),
  "mint.reserve": async (context) => {
    const operation = await rpc<OperationEnvelope>("mint_reserve", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: requireOperationId(context),
      p_template_id: context.input.template_id,
    });
    if (operation.status === "failed") return operationResult(operation);
    const reservation = operation.result as Reservation;
    if (!("permit_payload" in reservation)) return operationResult(operation);
    const payload = reservation.permit_payload;
    const permit: MintPermit = {
      mint_id: payload.mint_id,
      nft_number: payload.nft_number,
      nonce: payload.nonce,
      receiver: payload.receiver,
      template_id: payload.template_id,
      expires_at: payload.valid_until,
    };
    const signed = signMintPermit(permit);
    return operationResult(
      await rpc<OperationEnvelope>("mint_attach_permit", {
        p_mint_id: reservation.mint.id,
        p_permit: JSON.stringify(signed),
      }),
    );
  },
  "mint.submit": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("mint_submit", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_mint_id: context.input.mint_id,
        p_transaction_hash: context.input.transaction_hash,
      }),
    ),
  "mint.cancel": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("mint_cancel", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_mint_id: context.input.mint_id,
      }),
    ),
} satisfies HandlerMap;
