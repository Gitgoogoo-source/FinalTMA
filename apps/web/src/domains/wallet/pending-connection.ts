import type { Wallet } from "@tonconnect/ui-react";
import type { RouteInput } from "@evomypet/api-contracts/app-client";

export const PENDING_WALLET_KEY = "evomypet.ton-pending.v1";
export type PendingWalletConnection = {
  userId: string;
  payload: string;
  expiresAt: number;
};

// Store only the short-lived server challenge, never a wallet key or signature.
export function savePendingWalletConnection(
  pending: PendingWalletConnection,
): void {
  localStorage.setItem(PENDING_WALLET_KEY, JSON.stringify(pending));
}

export function readPendingWalletConnection(
  userId: string | undefined,
  now = Date.now(),
): PendingWalletConnection | null {
  if (!userId) return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(PENDING_WALLET_KEY) ?? "null",
    ) as PendingWalletConnection | null;
    if (
      value &&
      value.userId === userId &&
      typeof value.payload === "string" &&
      value.payload.length > 0 &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > now
    )
      return value;
    localStorage.removeItem(PENDING_WALLET_KEY);
  } catch {
    /* Storage may be unavailable in a restricted WebView. */
  }
  return null;
}

export function clearPendingWalletConnection(
  pending: PendingWalletConnection,
): void {
  try {
    const value = JSON.parse(
      localStorage.getItem(PENDING_WALLET_KEY) ?? "null",
    ) as PendingWalletConnection | null;
    if (value?.userId === pending.userId && value.payload === pending.payload)
      localStorage.removeItem(PENDING_WALLET_KEY);
  } catch {
    /* Closing the panel must remain possible if storage fails. */
  }
}

export function walletVerificationInput(
  wallet: Wallet,
  pending: PendingWalletConnection,
  userId: string | undefined,
  now = Date.now(),
): RouteInput<"wallet.verify"> {
  if (pending.userId !== userId) throw new Error("WALLET_CONNECTION_CANCELLED");
  if (pending.expiresAt <= now) throw new Error("WALLET_CONNECTION_EXPIRED");
  const item = wallet.connectItems?.tonProof;
  if (!item || !("proof" in item) || item.proof.payload !== pending.payload)
    throw new Error("WALLET_PROOF_MISSING");
  const { proof } = item;
  return {
    account: {
      address: wallet.account.address,
      chain: wallet.account.chain,
      ...(wallet.account.publicKey
        ? { public_key: wallet.account.publicKey }
        : {}),
      ...(wallet.account.walletStateInit
        ? { wallet_state_init: wallet.account.walletStateInit }
        : {}),
    },
    proof: {
      timestamp: proof.timestamp,
      domain: {
        length_bytes: proof.domain.lengthBytes,
        value: proof.domain.value,
      },
      payload: proof.payload,
      signature: proof.signature,
    },
    wallet_app_name: wallet.device.appName,
  };
}
