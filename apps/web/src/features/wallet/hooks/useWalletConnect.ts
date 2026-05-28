import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useIsConnectionRestored,
  useTonAddress,
  useTonConnectModal,
  useTonConnectUI,
  useTonWallet,
} from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { getApiErrorMessage, isApiClientError } from "@/api/errors";
import { queryKeys } from "@/shared/constants/queryKeys";

import { connectWallet } from "../wallet.api";
import type {
  ConnectWalletInput,
  WalletConnectionStatus,
  WalletStatusData,
  WalletVerificationStatus,
} from "../wallet.types";
import { useDisconnectWallet } from "./useDisconnectWallet";
import { useWalletProof } from "./useWalletProof";
import { useWalletStatus } from "./useWalletStatus";

type UnknownRecord = Record<string, unknown>;

type UseWalletConnectOptions = {
  enabled?: boolean;
  statusQueryEnabled?: boolean;
};

export function useWalletConnect({
  enabled = true,
  statusQueryEnabled = true,
}: UseWalletConnectOptions = {}) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const queryClient = useQueryClient();
  const [tonConnectUI] = useTonConnectUI();
  const modal = useTonConnectModal();
  const wallet = useTonWallet();
  const friendlyAddress = useTonAddress();
  const isConnectionRestored = useIsConnectionRestored();
  const proof = useWalletProof({ userId });
  const connectedSignatureRef = useRef<string | null>(null);
  const verifiedWalletRef = useRef<string | null>(null);

  const statusQuery = useWalletStatus({
    enabled: enabled && statusQueryEnabled,
    userId,
  });

  const connectMutation = useMutation({
    mutationFn: connectWallet,
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.status(userId),
      });
    },
  });

  const disconnectMutation = useDisconnectWallet({
    userId,
  });

  const currentWalletInput = useMemo(
    () => buildConnectWalletInput(wallet, friendlyAddress),
    [friendlyAddress, wallet],
  );
  const isModalOpen = modal.state?.status === "opened";
  const remoteStatus = statusQuery.data ?? null;

  useEffect(() => {
    if (
      !enabled ||
      !session.isAuthenticated ||
      !isConnectionRestored ||
      !currentWalletInput
    ) {
      return;
    }

    const signature = [
      currentWalletInput.rawAddress,
      currentWalletInput.address,
      currentWalletInput.network,
      currentWalletInput.walletAppName,
    ].join(":");

    if (connectedSignatureRef.current === signature) {
      return;
    }

    connectedSignatureRef.current = signature;
    connectMutation.mutate(currentWalletInput);
  }, [
    connectMutation,
    currentWalletInput,
    enabled,
    isConnectionRestored,
    session.isAuthenticated,
  ]);

  useEffect(() => {
    if (!enabled || !session.isAuthenticated || !wallet) {
      return;
    }

    const signature = readWalletProofSignature(wallet);

    if (!signature || verifiedWalletRef.current === signature) {
      return;
    }

    verifiedWalletRef.current = signature;
    void proof.verifyConnectedWallet(wallet).catch(() => undefined);
  }, [enabled, proof, session.isAuthenticated, wallet]);

  const openWalletModal = useCallback(async () => {
    let proofReady = true;

    try {
      await proof.prepareTonProofRequest();
    } catch {
      proofReady = false;
    }

    await tonConnectUI.openModal();
    return { proofReady };
  }, [proof, tonConnectUI]);

  const verifyWallet = useCallback(async () => {
    if (tonConnectUI.connected) {
      await tonConnectUI.disconnect();
    }

    return openWalletModal();
  }, [openWalletModal, tonConnectUI]);

  const disconnectCurrentWallet = useCallback(async () => {
    let backendDisconnectError: unknown = null;

    if (session.isAuthenticated) {
      try {
        await disconnectMutation.mutateAsync();
      } catch (error) {
        backendDisconnectError = error;
      }
    }

    await tonConnectUI.disconnect();
    connectedSignatureRef.current = null;
    verifiedWalletRef.current = null;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.wallet.status(userId),
    });

    if (backendDisconnectError) {
      throw backendDisconnectError;
    }
  }, [
    disconnectMutation,
    queryClient,
    session.isAuthenticated,
    tonConnectUI,
    userId,
  ]);

  const refetchStatus = useCallback(async () => {
    await statusQuery.refetch();
  }, [statusQuery]);

  const proofErrorStatus = getWalletProofErrorStatus(proof.proofError);
  const status = deriveWalletStatus({
    currentWalletInput,
    isConnectionRestored,
    isModalOpen,
    proofErrorStatus,
    remoteStatus,
  });
  const displayWallet = deriveWalletData(
    remoteStatus,
    currentWalletInput,
    proofErrorStatus,
  );
  const errorMessage =
    remoteStatus?.errorMessage ??
    getFirstErrorMessage(
      statusQuery.error,
      connectMutation.error,
      disconnectMutation.error,
      proof.proofError,
    );

  return {
    address: displayWallet.address,
    disconnectWallet: disconnectCurrentWallet,
    errorMessage,
    isConnected:
      status === "connected_unverified" ||
      status === "verified" ||
      status === "invalid_proof" ||
      status === "expired_proof",
    isConnecting:
      !isConnectionRestored ||
      isModalOpen ||
      connectMutation.isPending ||
      proof.isPreparingProof,
    isConnectionRestored,
    isDisconnecting: disconnectMutation.isPending,
    isStatusLoading: statusQuery.isLoading || statusQuery.isFetching,
    isVerifying: proof.isVerifying,
    openWalletModal,
    refetchStatus,
    status,
    verificationStatus: toVerificationStatus(status),
    verifyWallet,
    wallet: displayWallet,
  };
}

function deriveWalletStatus(options: {
  currentWalletInput: ConnectWalletInput | null;
  isConnectionRestored: boolean;
  isModalOpen: boolean;
  proofErrorStatus: WalletConnectionStatus | null;
  remoteStatus: WalletStatusData | null;
}): WalletConnectionStatus {
  if (!options.isConnectionRestored || options.isModalOpen) {
    return "connecting";
  }

  if (options.currentWalletInput) {
    if (
      options.remoteStatus?.status === "verified" &&
      isSameAddress(options.remoteStatus, options.currentWalletInput)
    ) {
      return "verified";
    }

    if (
      (options.remoteStatus?.status === "invalid_proof" ||
        options.remoteStatus?.status === "expired_proof") &&
      isSameAddress(options.remoteStatus, options.currentWalletInput)
    ) {
      return options.remoteStatus.status;
    }

    if (options.proofErrorStatus) {
      return options.proofErrorStatus;
    }

    return "connected_unverified";
  }

  return options.remoteStatus?.status ?? "not_connected";
}

function deriveWalletData(
  remoteStatus: WalletStatusData | null,
  currentWalletInput: ConnectWalletInput | null,
  proofErrorStatus: WalletConnectionStatus | null,
): WalletStatusData {
  if (currentWalletInput) {
    const isRemoteSameWallet =
      remoteStatus && isSameAddress(remoteStatus, currentWalletInput);

    return {
      status:
        isRemoteSameWallet && remoteStatus.status === "verified"
          ? "verified"
          : (proofErrorStatus ?? "connected_unverified"),
      address: currentWalletInput.address,
      rawAddress: currentWalletInput.rawAddress ?? currentWalletInput.address,
      network:
        currentWalletInput.network ??
        (isRemoteSameWallet ? remoteStatus.network : null),
      walletAppName:
        currentWalletInput.walletAppName ??
        (isRemoteSameWallet ? remoteStatus.walletAppName : null),
      verifiedAt: isRemoteSameWallet ? remoteStatus.verifiedAt : null,
      lastSyncAt: isRemoteSameWallet ? remoteStatus.lastSyncAt : null,
      syncStatus: remoteStatus?.syncStatus ?? "idle",
      mintQueue: remoteStatus?.mintQueue ?? null,
      errorMessage: remoteStatus?.errorMessage ?? null,
    };
  }

  return (
    remoteStatus ?? {
      status: "not_connected",
      address: null,
      rawAddress: null,
      network: null,
      walletAppName: null,
      verifiedAt: null,
      lastSyncAt: null,
      syncStatus: "idle",
      mintQueue: null,
      errorMessage: null,
    }
  );
}

export function getWalletProofErrorStatus(
  error: unknown,
): WalletConnectionStatus | null {
  if (!isApiClientError(error)) {
    return null;
  }

  switch (error.code) {
    case "WALLET_PROOF_EXPIRED":
    case "TON_PROOF_EXPIRED":
      return "expired_proof";
    case "WALLET_NETWORK_MISMATCH":
    case "WALLET_PROOF_INVALID":
    case "WALLET_PROOF_REPLAYED":
      return "invalid_proof";
    default:
      return null;
  }
}

function buildConnectWalletInput(
  wallet: unknown,
  friendlyAddress: string,
): ConnectWalletInput | null {
  const payload = isRecord(wallet) ? wallet : {};
  const account = isRecord(payload.account) ? payload.account : null;
  const rawAddress = readString(account?.address);
  const address = friendlyAddress || rawAddress;

  if (!address || !rawAddress) {
    return null;
  }

  const chain = readString(account?.chain);

  return {
    address,
    rawAddress,
    network: chain,
    walletAppName: readWalletAppName(wallet),
    account: chain
      ? {
          address: rawAddress,
          chain,
          walletStateInit: readString(account?.walletStateInit),
          publicKey: readString(account?.publicKey),
        }
      : null,
  };
}

function isSameAddress(
  remoteStatus: WalletStatusData,
  input: ConnectWalletInput,
): boolean {
  const remoteAddress = (remoteStatus.rawAddress ?? remoteStatus.address ?? "")
    .trim()
    .toLowerCase();
  const inputAddress = (input.rawAddress ?? input.address).trim().toLowerCase();
  const inputFriendlyAddress = input.address.trim().toLowerCase();

  return (
    remoteAddress === inputAddress || remoteAddress === inputFriendlyAddress
  );
}

function toVerificationStatus(
  status: WalletConnectionStatus,
): WalletVerificationStatus {
  switch (status) {
    case "verified":
      return "verified";
    case "invalid_proof":
      return "invalid_proof";
    case "expired_proof":
      return "expired_proof";
    default:
      return "unverified";
  }
}

function getFirstErrorMessage(...errors: unknown[]): string | null {
  const error = errors.find(Boolean);

  return error ? getApiErrorMessage(error) : null;
}

function readWalletProofSignature(wallet: unknown): string | null {
  const payload = isRecord(wallet) ? wallet : {};
  const connectItems = isRecord(payload.connectItems)
    ? payload.connectItems
    : null;
  const tonProof = isRecord(connectItems?.tonProof)
    ? connectItems.tonProof
    : null;
  const proof = isRecord(tonProof?.proof) ? tonProof.proof : null;

  return readString(proof?.signature);
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
