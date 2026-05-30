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
  | "flags"
  | "danger"
  | "admins"
  | "roles"
  | "permissions";

export type AdminPermissionMode = "all" | "any";
