export type WalletConnectionStatus =
  | "not_connected"
  | "connecting"
  | "connected_unverified"
  | "verified"
  | "invalid_proof"
  | "expired_proof"
  | "disconnected";

export type WalletVerificationStatus =
  | "unverified"
  | "verified"
  | "invalid_proof"
  | "expired_proof";

export type WalletSyncStatus =
  | "idle"
  | "queued"
  | "syncing"
  | "success"
  | "failed"
  | "disabled";

export type WalletMintQueueSummary = {
  queued: number;
  processing: number;
  failed: number;
  manualReview: number;
};

export type WalletStatusData = {
  status: WalletConnectionStatus;
  address: string | null;
  rawAddress: string | null;
  network: string | null;
  walletAppName: string | null;
  verifiedAt: string | null;
  lastSyncAt: string | null;
  syncStatus: WalletSyncStatus;
  mintQueue: WalletMintQueueSummary | null;
  errorMessage: string | null;
};

export type WalletAccountPayload = {
  address: string;
  chain: string;
  walletStateInit?: string | null;
  publicKey?: string | null;
};

export type WalletProofPayload = {
  timestamp: number;
  domain: {
    lengthBytes: number;
    value: string;
  };
  payload: string;
  signature: string;
};

export type WalletChallenge = {
  challenge: string;
  tonProofPayload: string;
  expiresAt: string | null;
};

export type ConnectWalletInput = {
  address: string;
  rawAddress?: string | null;
  network?: string | null;
  walletAppName?: string | null;
  account?: WalletAccountPayload | null;
  idempotencyKey?: string | null;
};

export type VerifyWalletProofInput = {
  account: WalletAccountPayload;
  proof: WalletProofPayload;
  walletAppName?: string | null;
  challenge?: string | null;
  idempotencyKey?: string | null;
};

export type WalletSyncResult = {
  status: WalletSyncStatus;
  jobId: string | null;
  lastSyncAt: string | null;
  message: string | null;
};
