import type {
  Database,
  Json,
} from "../../../packages/db-types/src/database.types.js";

type CoreUserRow = Database["core"]["Tables"]["users"]["Row"];
type CurrencyLedgerRow =
  Database["economy"]["Tables"]["currency_ledger"]["Row"];
type DrawOrderRow = Database["gacha"]["Tables"]["draw_orders"]["Row"];
type DrawResultRow = Database["gacha"]["Tables"]["draw_results"]["Row"];
type ItemInstanceRow = Database["inventory"]["Tables"]["item_instances"]["Row"];
type StarOrderRow = Database["payments"]["Tables"]["star_orders"]["Row"];
type StarPaymentRow = Database["payments"]["Tables"]["star_payments"]["Row"];
type TelegramWebhookEventRow =
  Database["payments"]["Tables"]["telegram_webhook_events"]["Row"];

export type AdminApiEnvelope<T> = {
  ok: true;
  success: true;
  data: T;
  requestId?: string;
};

export type AdminApiErrorEnvelope = {
  ok: false;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
};

export type PaymentOrder = {
  id: string;
  user_id: string;
  business_type: string;
  business_id: string | null;
  status: string;
  xtr_amount: number;
  telegram_invoice_payload: string;
  title: string;
  description: string | null;
  expires_at: string | null;
  precheckout_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
  payment: {
    id: string;
    star_order_id?: string;
    user_id?: string;
    currency: string;
    xtr_amount: number;
    invoice_payload?: string;
    paid_at: string;
    created_at?: string;
  } | null;
};

export type WebhookEvent = {
  id: string;
  update_id: number | string | null;
  event_type: string;
  user_id?: string | null;
  telegram_user_id?: number | string | null;
  invoice_payload: string | null;
  process_status: string;
  processed_at: string | null;
  error_message: string | null;
  retry_count: number | string;
  next_retry_at: string | null;
  webhook_secret_verified: boolean;
  status_context?: unknown;
  created_at: string;
};

export type PaymentRefund = {
  id: string;
  star_payment_id: string;
  star_order_id: string;
  user_id: string;
  xtr_amount: number | string;
  status: string;
  reason: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentDispute = {
  id: string;
  user_id: string;
  star_order_id: string | null;
  star_payment_id: string | null;
  status: string;
  subject: string;
  message: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentAdminResponse = {
  orders: PaymentOrder[];
  events: WebhookEvent[];
  exceptions: PaymentOrder[];
  refunds: PaymentRefund[];
  disputes: PaymentDispute[];
  summary: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type PaymentDetailOrder = Pick<
  StarOrderRow,
  | "id"
  | "user_id"
  | "business_type"
  | "business_id"
  | "status"
  | "xtr_amount"
  | "telegram_invoice_payload"
  | "title"
  | "description"
  | "idempotency_key"
  | "expires_at"
  | "precheckout_at"
  | "paid_at"
  | "fulfilled_at"
  | "error_message"
  | "metadata"
  | "created_at"
  | "updated_at"
>;

export type PaymentDetailUser = Pick<
  CoreUserRow,
  | "id"
  | "telegram_user_id"
  | "username"
  | "first_name"
  | "last_name"
  | "status"
  | "risk_score"
  | "last_seen_at"
  | "last_auth_at"
  | "created_at"
>;

export type PaymentDetailPayment = Pick<
  StarPaymentRow,
  | "id"
  | "star_order_id"
  | "user_id"
  | "telegram_payment_charge_id"
  | "provider_payment_charge_id"
  | "xtr_amount"
  | "currency"
  | "invoice_payload"
  | "paid_at"
  | "created_at"
  | "metadata"
>;

export type PaymentDetailDrawOrder = Pick<
  DrawOrderRow,
  | "id"
  | "user_id"
  | "box_id"
  | "pool_version_id"
  | "payment_star_order_id"
  | "status"
  | "quantity"
  | "draw_count"
  | "unit_price_stars"
  | "discount_bps"
  | "total_price_stars"
  | "open_reward_kcoin"
  | "invoice_payload"
  | "paid_at"
  | "opened_at"
  | "payment_provider"
  | "payment_status"
  | "star_amount"
  | "telegram_invoice_payload"
  | "telegram_payment_charge_id"
  | "error_message"
  | "metadata"
  | "created_at"
  | "updated_at"
>;

export type PaymentDetailDrawResult = Pick<
  DrawResultRow,
  | "id"
  | "draw_order_id"
  | "user_id"
  | "box_id"
  | "pool_version_id"
  | "draw_index"
  | "drop_pool_item_id"
  | "item_instance_id"
  | "template_id"
  | "form_id"
  | "rarity_code"
  | "was_pity"
  | "random_roll"
  | "metadata"
  | "created_at"
>;

export type PaymentDetailItemInstance = Pick<
  ItemInstanceRow,
  | "id"
  | "owner_user_id"
  | "template_id"
  | "form_id"
  | "serial_no"
  | "level"
  | "power"
  | "status"
  | "source_type"
  | "source_id"
  | "nft_mint_status"
  | "minted_nft_item_id"
  | "acquired_at"
  | "created_at"
>;

export type PaymentDetailLedgerEntry = Pick<
  CurrencyLedgerRow,
  | "id"
  | "user_id"
  | "currency_code"
  | "entry_type"
  | "amount"
  | "available_before"
  | "available_after"
  | "locked_before"
  | "locked_after"
  | "source_type"
  | "source_id"
  | "source_ref"
  | "idempotency_key"
  | "note"
  | "created_at"
>;

export type PaymentDetailWebhookEvent = WebhookEvent &
  Pick<
    TelegramWebhookEventRow,
    "payload" | "processing_duration_ms" | "request_headers_hash"
  >;

export type PaymentDetailErrorContext = {
  code: string | null;
  message: string | null;
  requestId: string | null;
  errorStack?: string | null;
  stack?: string | null;
  raw?: Json | null;
};

export type PaymentDetailResponse = {
  order: PaymentDetailOrder;
  user: PaymentDetailUser | null;
  payment: PaymentDetailPayment | null;
  drawOrder: PaymentDetailDrawOrder | null;
  drawResults: PaymentDetailDrawResult[];
  itemInstances: PaymentDetailItemInstance[];
  ledgerEntries: PaymentDetailLedgerEntry[];
  webhookEvents: PaymentDetailWebhookEvent[];
  errorContext: PaymentDetailErrorContext | null;
  serverTime: string;
};

export type MonitoringStatus = "ok" | "warning" | "critical";

export type MonitoringRateMetric = {
  key: string;
  label: string;
  value: number;
  unit: "percent";
  numerator: number;
  denominator: number;
  stuckCount?: number;
  status: MonitoringStatus;
  description: string;
};

export type MonitoringLatencyMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: "milliseconds";
  averageMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  processedCount: number;
  pendingCount: number;
  stuckCount: number;
  status: MonitoringStatus;
  description: string;
};

export type MonitoringCountMetric = {
  key: string;
  label: string;
  value: number;
  unit: "count";
  activeCount: number;
  stuckCount: number;
  status: MonitoringStatus;
  description: string;
};

export type MonitoringException = {
  id: string;
  userId?: string;
  updateId?: number | string | null;
  eventType?: string;
  processStatus?: string;
  status?: string;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  processedAt?: string | null;
  completedAt?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type MonitoringResponse = {
  window: {
    hours: number;
    startedAt: string;
    endedAt: string;
  };
  thresholds: {
    webhookStuckMinutes: number;
    fulfillmentStuckMinutes: number;
    mintStuckMinutes: number;
  };
  metrics: {
    paymentFailureRate: MonitoringRateMetric;
    fulfillmentFailureRate: MonitoringRateMetric;
    webhookLatency: MonitoringLatencyMetric;
    mintStuckCount: MonitoringCountMetric;
  };
  recentExceptions: {
    paymentOrders: MonitoringException[];
    webhookEvents: MonitoringException[];
    mintQueue: MonitoringException[];
  };
  sources: Record<string, number>;
  serverTime: string;
};

export type MintQueueItem = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  collection_id: string;
  item_instance_id: string;
  template_id?: string;
  form_id?: string | null;
  status: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  nft_item_id?: string | null;
  tx_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  wallet: {
    address: string;
    network: string;
    wallet_app_name: string | null;
    verified_at: string | null;
  } | null;
  transaction: {
    tx_hash: string | null;
    query_id: string | null;
    status: string;
    error_message: string | null;
    created_at: string;
  } | null;
};

export type MintQueueResponse = {
  items: MintQueueItem[];
  summary: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type WalletItem = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  address_raw: string | null;
  wallet_app_name: string | null;
  wallet_device?: string | null;
  is_primary?: boolean;
  status: string;
  verified_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  metadata?: unknown;
  created_at: string;
  updated_at?: string;
  latest_proof: {
    id?: string;
    address?: string | null;
    status: string;
    domain: string | null;
    expires_at?: string;
    verified_at: string | null;
    error_message: string | null;
    created_at: string;
  } | null;
};

export type WalletsResponse = {
  items: WalletItem[];
  summary: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type FeatureFlag = {
  key: string;
  enabled: boolean;
  description: string | null;
  rollout?: unknown;
  updated_by_admin_id: string | null;
  updated_at: string;
  created_at: string;
};

export type FeatureFlagsResponse = {
  items: FeatureFlag[];
  serverTime: string;
};

export type BannerCampaign = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  image_url: string;
  placement: string;
  target_type: string;
  target_ref: string | null;
  target_payload?: unknown;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
};

export type BoxPriceRule = {
  id: string;
  box_id: string;
  quantity: number;
  discount_bps: number;
  price_stars_override: number | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
};

export type BlindBoxAdminItem = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  tier: string;
  status: string;
  price_stars: number;
  total_stock: number | null;
  remaining_stock: number | null;
  open_reward_kcoin: number | string;
  cover_image_url: string | null;
  hero_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
  active_version?: DropPoolVersion | null;
  version_count?: number;
  active_item_count?: number;
  price_rules?: BoxPriceRule[];
};

export type DropPoolVersion = {
  id: string;
  box_id: string;
  version_no: number;
  status: string;
  total_weight: number | string;
  published_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  config_snapshot?: unknown;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
};

export type DropPoolItem = {
  id: string;
  pool_version_id: string;
  template_id: string;
  form_id: string | null;
  rarity_code: string;
  drop_weight: number | string;
  probability_bps: number | string | null;
  stock_total: number | string | null;
  stock_remaining: number | string | null;
  is_pity_eligible: boolean;
  is_featured: boolean;
  sort_order: number;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
  template_slug?: string | null;
  template_display_name?: string | null;
  form_display_name?: string | null;
};

export type PityRule = {
  id: string;
  box_id: string;
  pool_version_id: string | null;
  rule_name: string;
  threshold: number;
  target_rarity_code: string;
  reset_on_rarity_code: string | null;
  guaranteed_template_id: string | null;
  guaranteed_form_id: string | null;
  priority: number;
  active: boolean;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
  guaranteed_template_display_name?: string | null;
  guaranteed_form_display_name?: string | null;
};

export type DropPoolValidationIssue = {
  code: string;
  message: string;
  field?: string | null;
  severity?: "error" | "warning" | "info";
};

export type DropPoolValidationResult = {
  valid: boolean;
  validation_errors: DropPoolValidationIssue[];
  warnings: DropPoolValidationIssue[];
  total_weight?: number | string;
  computed_probability_bps?: number;
  audit_log_id?: string | null;
  idempotent?: boolean;
  serverTime?: string;
};

export type BlindBoxesAdminResponse = {
  items: BlindBoxAdminItem[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type CampaignsResponse = {
  items: BannerCampaign[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type AdminConfigMutationResponse = Record<string, unknown> & {
  audit_log_id?: string | null;
  idempotent?: boolean;
  serverTime: string;
};

export type UpsertCampaignInput = {
  id?: string;
  code: string;
  title: string;
  description?: string | null;
  image_url: string;
  placement: string;
  target_type: string;
  target_ref?: string | null;
  target_payload?: Record<string, unknown>;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type UpsertBlindBoxInput = {
  id?: string;
  slug: string;
  display_name: string;
  description?: string | null;
  tier: string;
  status: string;
  price_stars: number;
  total_stock?: number | null;
  remaining_stock?: number | null;
  open_reward_kcoin: number;
  cover_image_url?: string | null;
  hero_image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type UpdateBlindBoxStatusInput = {
  boxId: string;
  status: string;
  reason: string;
};

export type UpsertBoxPriceRuleInput = {
  id?: string;
  box_id: string;
  quantity: number;
  discount_bps: number;
  price_stars_override?: number | null;
  active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type AdminStorageTargetBucket = "banners" | "boxes" | "collectibles";

export type AdminStorageSignedUpload = {
  tempBucket: "admin-temp";
  tempPath: string;
  targetBucket: AdminStorageTargetBucket;
  signedUrl: string;
  previewUrl?: string | null;
  contentType: string;
  sizeBytes: number;
  maxSizeBytes: number;
  expiresAt: string;
  previewExpiresAt?: string | null;
};

export type AdminStoragePreview = {
  tempBucket: "admin-temp";
  tempPath: string;
  targetBucket: AdminStorageTargetBucket;
  previewUrl: string;
  previewExpiresAt: string;
};

export type AdminStoragePublishedAsset = {
  bucket: AdminStorageTargetBucket;
  path: string;
  publicUrl: string;
  publishedAt: string;
};

export type DropPoolVersionsResponse = {
  items: DropPoolVersion[];
  activeVersion: DropPoolVersion | null;
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type DropPoolItemsResponse = {
  items: DropPoolItem[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type PityRulesResponse = {
  items: PityRule[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type DropPoolDraftItemInput = Pick<
  DropPoolItem,
  | "template_id"
  | "form_id"
  | "rarity_code"
  | "drop_weight"
  | "probability_bps"
  | "stock_total"
  | "stock_remaining"
  | "is_pity_eligible"
  | "is_featured"
  | "sort_order"
> & {
  id?: string;
  metadata?: unknown;
};

export type DropPoolDraftPityRuleInput = Pick<
  PityRule,
  | "rule_name"
  | "threshold"
  | "target_rarity_code"
  | "reset_on_rarity_code"
  | "guaranteed_template_id"
  | "guaranteed_form_id"
  | "priority"
  | "active"
> & {
  id?: string;
  metadata?: unknown;
};

export type DropPoolMutationResponse = {
  audit_log_id?: string | null;
  drop_pool_version_id?: string;
  validation?: DropPoolValidationResult;
  idempotent?: boolean;
  serverTime: string;
};

export type AdminAuditLogAdmin = {
  id: string;
  display_name: string | null;
  telegram_user_id: number | string | null;
  email: string | null;
};

export type AuditRiskLevel = "low" | "medium" | "high";

export type AdminAuditLogBase = {
  id: string;
  admin_user_id: string | null;
  admin?: AdminAuditLogAdmin | null;
  action: string;
  target_schema: string | null;
  target_table: string | null;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  ip_hash?: string | null;
  user_agent?: string | null;
  reason: string | null;
  request_id?: string | null;
  requestId?: string | null;
  risk_level?: AuditRiskLevel | null;
  created_at: string;
};

export type AdminAuditCorrection = AdminAuditLogBase;

export type AdminAuditLog = AdminAuditLogBase & {
  corrections?: AdminAuditCorrection[];
};

export type AuditLogFilters = {
  adminUserId?: string;
  action?: string;
  targetSchema?: string;
  targetTable?: string;
  targetId?: string;
  from?: string;
  to?: string;
  riskLevel?: AuditRiskLevel;
  q?: string;
  cursor?: string | null;
  limit?: number;
};

export type AuditLogsResponse = {
  items: AdminAuditLog[];
  summary: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type AdminMeResponse = {
  adminId: string;
  roleCode: string | null;
  permissions: string[];
  isSuperAdmin: boolean;
  serverTime: string;
};

export type AdminRoleSummary = {
  id: string;
  code: string;
  display_name: string | null;
};

export type AdminUser = {
  id: string;
  core_user_id: string | null;
  telegram_user_id: number | string | null;
  display_name: string | null;
  status: string;
  roles: AdminRoleSummary[];
  last_login_at: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type AdminRole = AdminRoleSummary & {
  permissions: string[];
  admin_user_count: number;
  created_at: string;
  updated_at?: string | null;
};

export type AdminPermissionMatrix = {
  domains: AdminPermissionDomain[];
  serverTime: string;
};

export type AdminPermissionDomain = {
  domain: string;
  label: string;
  description: string;
  permissions: AdminPermissionDefinition[];
};

export type AdminPermissionDefinition = {
  code: string;
  label: string;
  description: string;
  risk: "read" | "write" | "danger";
};

export type AdminUsersResponse = {
  items: AdminUser[];
  summary: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type AdminRolesResponse = {
  items: AdminRole[];
  serverTime: string;
};

export type AdminTab =
  | "monitoring"
  | "payments"
  | "mint"
  | "wallets"
  | "campaigns"
  | "blind-boxes"
  | "gacha-pools"
  | "flags"
  | "danger"
  | "audit"
  | "admins"
  | "roles"
  | "permissions";

export type AdminPermissionMode = "all" | "any";
