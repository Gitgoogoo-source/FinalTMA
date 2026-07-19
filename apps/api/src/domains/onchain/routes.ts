import { rpc } from "../../platform/db/index.ts";
import { getEnv } from "../../platform/env/index.ts";
import { signMintPermit, type MintPermit } from "../../platform/ton/permit.ts";
import {
  createTonProofChallenge,
  createTonProofExpiresAt,
  verifyTonProof,
} from "../../platform/ton/tonConnect.ts";
import { resolveVerifiedTonWalletPublicKey } from "../../platform/ton/walletPublicKey.ts";
import {
  operationResult,
  type OperationEnvelope,
} from "../operations/mappers.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../types.ts";

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

export const onchainHandlers = {
  "wallet.get": async (context) => ({
    data: await rpc("wallet_get", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "wallet.challenge": async (context) => {
    const payload = createTonProofChallenge({ prefix: "pokepets" });
    const expiresAt = createTonProofExpiresAt();
    return {
      data: await rpc("wallet_create_challenge", {
        p_session_id: requireSession(context).session_id,
        p_payload: payload,
        p_expires_at: expiresAt.toISOString(),
      }),
    };
  },
  "wallet.verify": async (context) => {
    const account = context.input.account as {
      address: string;
      chain: string;
      public_key?: string;
      wallet_state_init?: string;
    };
    const proof = context.input.proof as {
      timestamp: number;
      domain: { length_bytes: number; value: string };
      payload: string;
      signature: string;
    };
    const verified = await verifyTonProof({
      account: {
        address: account.address,
        chain: account.chain,
        publicKey: account.public_key,
        walletStateInit: account.wallet_state_init,
      },
      proof: {
        timestamp: proof.timestamp,
        domain: {
          lengthBytes: proof.domain.length_bytes,
          value: proof.domain.value,
        },
        payload: proof.payload,
        signature: proof.signature,
      },
      expectedDomain: new URL(getEnv().APP_BASE_URL).hostname,
      expectedPayload: proof.payload,
      resolvePublicKey: resolveVerifiedTonWalletPublicKey,
    });
    return operationResult(
      await rpc<OperationEnvelope>("wallet_save_verified", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_challenge: proof.payload,
        p_address: verified.address,
        p_network: verified.network,
        p_wallet_app_name: context.input.wallet_app_name,
        p_public_key: verified.walletPublicKey,
      }),
    );
  },
  "wallet.disconnect": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("wallet_disconnect", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
      }),
    ),
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
