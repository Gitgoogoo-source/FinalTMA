import { rpc } from "../../platform/db/index.ts";
import { getEnv } from "../../platform/env/index.ts";
import {
  createTonProofChallenge,
  createTonProofExpiresAt,
  verifyTonProof,
} from "../../platform/ton/tonConnect.ts";
import { resolveVerifiedTonWalletPublicKey } from "../../platform/ton/walletPublicKey.ts";
import {
  operationResult,
  type OperationEnvelope,
} from "../../http/operation-result.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../../http/handlers.ts";

export const walletHandlers = {
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
} satisfies HandlerMap;
