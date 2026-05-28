import { z } from "zod";

/**
 * wallet 模块说明：
 * - 面向 TON Connect、钱包绑定、ton_proof、链上 NFT 同步、Mint 队列。
 * - 前端只能提交公开地址、签名证明和操作请求。
 * - 钱包证明、链上交易状态、NFT 同步、Mint 发放必须由后端校验。
 */

/* -------------------------------------------------------------------------- */
/* 基础通用 schema                                                             */
/* -------------------------------------------------------------------------- */

export const UUIDSchema = z.string().uuid();

export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);

export const CursorSchema = z.string().trim().min(1).max(256);

export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

export const PaginationQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: PageSizeSchema.optional(),
});

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const BooleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return value;
}, z.boolean());

function csvArray<T extends z.ZodTypeAny>(itemSchema: T, max = 50) {
  return z.preprocess((value) => {
    if (typeof value === "string") {
      if (!value.trim()) return [];
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value;
  }, z.array(itemSchema).max(max));
}

/* -------------------------------------------------------------------------- */
/* TON 基础 schema                                                              */
/* -------------------------------------------------------------------------- */

const RAW_TON_ADDRESS_RE = /^-?\d+:[a-fA-F0-9]{64}$/;
const USER_FRIENDLY_TON_ADDRESS_RE = /^(?:EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;

export const TonAddressSchema = z
  .string()
  .trim()
  .min(10)
  .max(128)
  .refine(
    (value) =>
      RAW_TON_ADDRESS_RE.test(value) ||
      USER_FRIENDLY_TON_ADDRESS_RE.test(value),
    "TON 地址格式不正确",
  );

export const TonChainSchema = z.enum(["MAINNET", "TESTNET"]);

export const TonWorkchainSchema = z.coerce.number().int().min(-1).max(0);

export const HexSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]+$/, "必须是 hex 字符串");

export const TonPublicKeySchema = HexSchema.length(
  64,
  "publicKey 必须是 32 字节 hex",
);

export const TonTransactionHashSchema = z
  .string()
  .trim()
  .min(32)
  .max(128)
  .regex(/^[a-zA-Z0-9_+/=-]+$/);

export const Base64OrUrlSafeSchema = z
  .string()
  .trim()
  .min(8)
  .max(4096)
  .regex(/^[a-zA-Z0-9_+/=-]+$/);

export const DomainNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$/, "domain 格式不正确");

export const TonWalletAppNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9 ._-]+$/);

/* -------------------------------------------------------------------------- */
/* 钱包连接 / 证明 schema                                                       */
/* -------------------------------------------------------------------------- */

export const TonProofDomainSchema = z.object({
  lengthBytes: z.coerce.number().int().min(1).max(255),
  value: DomainNameSchema,
});

export const TonProofSchema = z.object({
  timestamp: z.coerce.number().int().positive(),
  domain: TonProofDomainSchema,
  payload: z.string().trim().min(8).max(512),
  signature: Base64OrUrlSafeSchema,
});

export const TonAccountSchema = z.object({
  address: TonAddressSchema,
  chain: TonChainSchema,
  publicKey: TonPublicKeySchema.optional(),
  walletStateInit: Base64OrUrlSafeSchema.optional(),
});

export const WalletDeviceSchema = z.object({
  platform: z
    .enum(["IOS", "ANDROID", "WEB", "DESKTOP", "UNKNOWN"])
    .default("UNKNOWN"),
  appName: z.string().trim().min(1).max(80).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
  userAgent: z.string().trim().max(500).optional(),
});

export const WalletConnectBodySchema = z.object({
  account: TonAccountSchema,
  walletAppName: TonWalletAppNameSchema.optional(),
  device: WalletDeviceSchema.optional(),
  tonProof: TonProofSchema.optional(),
  idempotencyKey: IdempotencyKeySchema.optional(),
});

export const WalletProofBodySchema = z.object({
  account: TonAccountSchema,
  proof: TonProofSchema,
  walletAppName: TonWalletAppNameSchema.optional(),
  device: WalletDeviceSchema.optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const WalletDisconnectBodySchema = z.object({
  address: TonAddressSchema.optional(),
  reason: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: IdempotencyKeySchema.optional(),
});

export const WalletStatusResponseSchema = z.object({
  connected: z.boolean(),
  verified: z.boolean(),
  status: z
    .enum([
      "not_connected",
      "connected_unverified",
      "verified",
      "disconnected",
      "revoked",
    ])
    .optional(),
  walletId: UUIDSchema.optional(),
  address: TonAddressSchema.optional(),
  chain: TonChainSchema.optional(),
  network: z.enum(["mainnet", "testnet"]).optional(),
  walletAppName: TonWalletAppNameSchema.optional(),
  verifiedAt: IsoDateTimeSchema.optional(),
  connectedAt: IsoDateTimeSchema.optional(),
  disconnectedAt: IsoDateTimeSchema.optional(),
  lastSyncAt: IsoDateTimeSchema.optional(),
  serverTime: IsoDateTimeSchema.optional(),
});

export const WalletProofResponseSchema = z.object({
  verified: z.boolean(),
  address: TonAddressSchema,
  chain: TonChainSchema,
  walletId: UUIDSchema.optional(),
  verifiedAt: IsoDateTimeSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 钱包 NFT 同步 schema                                                         */
/* -------------------------------------------------------------------------- */

export const WalletNftSyncModeSchema = z.enum(["INCREMENTAL", "FULL"]);

export const WalletNftSyncBodySchema = z.object({
  address: TonAddressSchema.optional(),
  chain: TonChainSchema.default("MAINNET"),
  mode: WalletNftSyncModeSchema.default("INCREMENTAL"),
  collectionAddress: TonAddressSchema.optional(),
  force: z.boolean().optional(),
  idempotencyKey: IdempotencyKeySchema.optional(),
});

export const WalletNftSyncQuerySchema = PaginationQuerySchema.extend({
  address: TonAddressSchema.optional(),
  chain: TonChainSchema.optional(),
  collectionAddress: TonAddressSchema.optional(),
  onlyKnownCollections: BooleanQuerySchema.optional(),
});

export const WalletNftItemSchema = z.object({
  nftItemId: UUIDSchema.optional(),
  itemAddress: TonAddressSchema,
  collectionAddress: TonAddressSchema.optional(),
  ownerAddress: TonAddressSchema,
  itemIndex: z.coerce.number().int().min(0).optional(),
  name: z.string().trim().max(120).optional(),
  imageUrl: z.string().url().optional(),
  metadataUrl: z.string().url().optional(),
  linkedItemInstanceId: UUIDSchema.optional(),
  syncedAt: IsoDateTimeSchema,
});

export const WalletNftSyncResponseSchema = z.object({
  jobId: UUIDSchema.optional(),
  accepted: z.boolean(),
  mode: WalletNftSyncModeSchema,
  syncedCount: z.coerce.number().int().min(0).optional(),
  nextCursor: CursorSchema.nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* Mint schema                                                                  */
/* -------------------------------------------------------------------------- */

export const MintQueueStatusSchema = z.enum([
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
  "manual_review",
  "minted",
  "failed",
  "cancelled",
]);

export const MintPrioritySchema = z
  .enum(["LOW", "NORMAL", "HIGH"])
  .default("NORMAL");

export const MintMetadataModeSchema = z.enum([
  "DATABASE_SNAPSHOT",
  "REFRESH_FROM_CATALOG",
]);

export const CreateMintBodySchema = z.object({
  itemInstanceId: UUIDSchema,
  targetAddress: TonAddressSchema.optional(),
  chain: TonChainSchema.default("MAINNET"),
  idempotencyKey: IdempotencyKeySchema,
});

export const MintStatusQuerySchema = PaginationQuerySchema.extend({
  mintQueueId: UUIDSchema.optional(),
  itemInstanceId: UUIDSchema.optional(),
  statuses: csvArray(MintQueueStatusSchema).optional(),
});

export const MintQueueItemSchema = z.object({
  mintQueueId: UUIDSchema,
  itemInstanceId: UUIDSchema,
  status: MintQueueStatusSchema,
  chain: TonChainSchema,
  collectionAddress: TonAddressSchema.optional(),
  itemAddress: TonAddressSchema.optional(),
  targetAddress: TonAddressSchema.optional(),
  transactionHash: TonTransactionHashSchema.optional(),
  errorCode: z.string().trim().min(1).max(80).optional(),
  errorMessage: z.string().trim().max(500).optional(),
  retryCount: z.coerce.number().int().min(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  mintedAt: IsoDateTimeSchema.optional(),
});

export const CreateMintResponseSchema = z.object({
  accepted: z.boolean(),
  mintQueueId: UUIDSchema,
  status: MintQueueStatusSchema,
});

export const MintStatusResponseSchema = z.object({
  items: z.array(MintQueueItemSchema),
  nextCursor: CursorSchema.nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* 链上交易 schema                                                              */
/* -------------------------------------------------------------------------- */

export const OnchainTransactionTypeSchema = z.enum([
  "MINT_NFT",
  "TRANSFER_NFT",
  "SYNC_NFT",
  "WALLET_PROOF",
  "SYSTEM",
]);

export const OnchainTransactionStatusSchema = z.enum([
  "pending",
  "confirmed",
  "failed",
  "expired",
]);

export const OnchainTransactionQuerySchema = PaginationQuerySchema.extend({
  type: OnchainTransactionTypeSchema.optional(),
  status: OnchainTransactionStatusSchema.optional(),
  address: TonAddressSchema.optional(),
  itemInstanceId: UUIDSchema.optional(),
  mintQueueId: UUIDSchema.optional(),
});

export const OnchainTransactionSchema = z.object({
  transactionId: UUIDSchema,
  type: OnchainTransactionTypeSchema,
  status: OnchainTransactionStatusSchema,
  chain: TonChainSchema,
  fromAddress: TonAddressSchema.optional(),
  toAddress: TonAddressSchema.optional(),
  transactionHash: TonTransactionHashSchema.optional(),
  queryId: z.string().trim().min(1).max(128).optional(),
  itemInstanceId: UUIDSchema.optional(),
  mintQueueId: UUIDSchema.optional(),
  createdAt: IsoDateTimeSchema,
  confirmedAt: IsoDateTimeSchema.optional(),
  failedAt: IsoDateTimeSchema.optional(),
  errorMessage: z.string().trim().max(500).optional(),
});

export const OnchainTransactionListResponseSchema = z.object({
  items: z.array(OnchainTransactionSchema),
  nextCursor: CursorSchema.nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* 后端内部链上回调 / worker schema                                             */
/* -------------------------------------------------------------------------- */

export const MarkMintSuccessBodySchema = z.object({
  mintQueueId: UUIDSchema,
  itemInstanceId: UUIDSchema,
  chain: TonChainSchema,
  collectionAddress: TonAddressSchema,
  itemAddress: TonAddressSchema,
  targetAddress: TonAddressSchema,
  transactionHash: TonTransactionHashSchema,
  itemIndex: z.coerce.number().int().min(0).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const MarkMintFailedBodySchema = z.object({
  mintQueueId: UUIDSchema,
  errorCode: z.string().trim().min(1).max(80),
  errorMessage: z.string().trim().min(1).max(500),
  retryable: z.boolean().default(true),
  idempotencyKey: IdempotencyKeySchema,
});

export const RetryMintBodySchema = z.object({
  mintQueueId: UUIDSchema,
  priority: MintPrioritySchema.optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 导出类型                                                                     */
/* -------------------------------------------------------------------------- */

export type UUID = z.infer<typeof UUIDSchema>;
export type TonAddress = z.infer<typeof TonAddressSchema>;
export type TonChain = z.infer<typeof TonChainSchema>;

export type TonProof = z.infer<typeof TonProofSchema>;
export type TonAccount = z.infer<typeof TonAccountSchema>;

export type WalletConnectBody = z.infer<typeof WalletConnectBodySchema>;
export type WalletProofBody = z.infer<typeof WalletProofBodySchema>;
export type WalletDisconnectBody = z.infer<typeof WalletDisconnectBodySchema>;

export type WalletStatusResponse = z.infer<typeof WalletStatusResponseSchema>;
export type WalletProofResponse = z.infer<typeof WalletProofResponseSchema>;

export type WalletNftSyncBody = z.infer<typeof WalletNftSyncBodySchema>;
export type WalletNftSyncQuery = z.infer<typeof WalletNftSyncQuerySchema>;
export type WalletNftSyncResponse = z.infer<typeof WalletNftSyncResponseSchema>;
export type WalletNftItem = z.infer<typeof WalletNftItemSchema>;

export type CreateMintBody = z.infer<typeof CreateMintBodySchema>;
export type CreateMintResponse = z.infer<typeof CreateMintResponseSchema>;
export type MintStatusQuery = z.infer<typeof MintStatusQuerySchema>;
export type MintStatusResponse = z.infer<typeof MintStatusResponseSchema>;
export type MintQueueItem = z.infer<typeof MintQueueItemSchema>;
export type MintQueueStatus = z.infer<typeof MintQueueStatusSchema>;

export type OnchainTransactionQuery = z.infer<
  typeof OnchainTransactionQuerySchema
>;
export type OnchainTransaction = z.infer<typeof OnchainTransactionSchema>;
export type OnchainTransactionListResponse = z.infer<
  typeof OnchainTransactionListResponseSchema
>;

export type MarkMintSuccessBody = z.infer<typeof MarkMintSuccessBodySchema>;
export type MarkMintFailedBody = z.infer<typeof MarkMintFailedBodySchema>;
export type RetryMintBody = z.infer<typeof RetryMintBodySchema>;
