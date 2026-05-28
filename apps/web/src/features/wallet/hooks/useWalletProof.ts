import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTonConnectUI } from "@tonconnect/ui-react";
import { useCallback, useRef } from "react";

import { queryKeys } from "@/shared/constants/queryKeys";

import { requestWalletChallenge, verifyWalletProof } from "../wallet.api";
import type {
  WalletAccountPayload,
  WalletChallenge,
  WalletProofPayload,
} from "../wallet.types";

type UnknownRecord = Record<string, unknown>;

type UseWalletProofOptions = {
  userId?: string | null | undefined;
};

export function useWalletProof(options: UseWalletProofOptions = {}) {
  const [tonConnectUI] = useTonConnectUI();
  const queryClient = useQueryClient();
  const latestChallengeRef = useRef<WalletChallenge | null>(null);
  const verifiedSignatureRef = useRef<string | null>(null);

  const challengeMutation = useMutation({
    mutationFn: requestWalletChallenge,
    meta: {
      skipGlobalErrorToast: true,
    },
  });

  const verifyMutation = useMutation({
    mutationFn: verifyWalletProof,
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.status(options.userId),
      });
    },
  });

  const prepareTonProofRequest = useCallback(async () => {
    tonConnectUI.setConnectRequestParameters({ state: "loading" });

    try {
      const challenge = await challengeMutation.mutateAsync();
      latestChallengeRef.current = challenge;
      tonConnectUI.setConnectRequestParameters({
        state: "ready",
        value: {
          tonProof: challenge.tonProofPayload,
        },
      });

      return challenge;
    } catch (error) {
      tonConnectUI.setConnectRequestParameters(null);
      throw error;
    }
  }, [challengeMutation, tonConnectUI]);

  const clearTonProofRequest = useCallback(() => {
    tonConnectUI.setConnectRequestParameters(null);
    latestChallengeRef.current = null;
  }, [tonConnectUI]);

  const verifyConnectedWallet = useCallback(
    async (wallet: unknown) => {
      const account = readWalletAccount(wallet);
      const proof = readWalletProof(wallet);

      if (!account || !proof) {
        return null;
      }

      if (verifiedSignatureRef.current === proof.signature) {
        return null;
      }

      verifiedSignatureRef.current = proof.signature;

      return verifyMutation.mutateAsync({
        account,
        proof,
        walletAppName: readWalletAppName(wallet),
        challenge: latestChallengeRef.current?.challenge ?? proof.payload,
      });
    },
    [verifyMutation],
  );

  return {
    challenge: latestChallengeRef.current,
    isPreparingProof: challengeMutation.isPending,
    isVerifying: verifyMutation.isPending,
    prepareTonProofRequest,
    clearTonProofRequest,
    verifyConnectedWallet,
    proofError: challengeMutation.error ?? verifyMutation.error ?? null,
  };
}

function readWalletAccount(wallet: unknown): WalletAccountPayload | null {
  const payload = isRecord(wallet) ? wallet : {};
  const account = isRecord(payload.account) ? payload.account : null;
  const address = readString(account?.address);
  const chain = readString(account?.chain);

  if (!address || !chain) {
    return null;
  }

  return {
    address,
    chain,
    walletStateInit: readString(account?.walletStateInit),
    publicKey: readString(account?.publicKey),
  };
}

function readWalletProof(wallet: unknown): WalletProofPayload | null {
  const payload = isRecord(wallet) ? wallet : {};
  const connectItems = isRecord(payload.connectItems)
    ? payload.connectItems
    : null;
  const tonProof = isRecord(connectItems?.tonProof)
    ? connectItems.tonProof
    : null;

  if (!tonProof || !("proof" in tonProof)) {
    return null;
  }

  const proof = isRecord(tonProof.proof) ? tonProof.proof : null;
  const domain = isRecord(proof?.domain) ? proof.domain : null;
  const timestamp = readNumber(proof?.timestamp);
  const lengthBytes = readNumber(domain?.lengthBytes);
  const domainValue = readString(domain?.value);
  const proofPayload = readString(proof?.payload);
  const signature = readString(proof?.signature);

  if (
    timestamp === null ||
    lengthBytes === null ||
    !domainValue ||
    !proofPayload ||
    !signature
  ) {
    return null;
  }

  return {
    timestamp,
    domain: {
      lengthBytes,
      value: domainValue,
    },
    payload: proofPayload,
    signature,
  };
}

function readWalletAppName(wallet: unknown): string | null {
  const payload = isRecord(wallet) ? wallet : {};
  const device = isRecord(payload.device) ? payload.device : null;

  return (
    readString(device?.appName) ??
    readString(device?.app_name) ??
    readString(payload.name) ??
    null
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
