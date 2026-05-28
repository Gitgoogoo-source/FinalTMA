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

export type WalletMintQueueStatus =
  | "queued"
  | "processing"
  | "submitted"
  | "confirming"
  | "retrying"
  | "manual_review"
  | "minted"
  | "failed"
  | "cancelled";

export type WalletMintQueueSummary = {
  queued: number;
  processing: number;
  submitted?: number;
  confirming?: number;
  retrying?: number;
  minted?: number;
  cancelled?: number;
  failed: number;
  manualReview: number;
};

export type WalletMintQueueItem = {
  mintQueueId: string;
  itemInstanceId: string;
  status: WalletMintQueueStatus;
  chain: "MAINNET" | "TESTNET";
  collectionAddress: string | null;
  itemAddress: string | null;
  targetAddress: string | null;
  transactionHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  mintedAt: string | null;
};

export type WalletMintQueueResponse = {
  items: WalletMintQueueItem[];
  summary: WalletMintQueueSummary;
  nextCursor: string | null;
  serverTime: string | null;
};

export type CreateMintInput = {
  itemInstanceId: string;
  targetAddress?: string | null;
  chain?: "MAINNET" | "TESTNET";
  idempotencyKey?: string | null;
};

export type CreateMintResult = {
  accepted: boolean;
  mintQueueId: string;
  status: WalletMintQueueStatus;
  itemInstanceId: string;
  metadataUrl: string | null;
  idempotent: boolean;
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
