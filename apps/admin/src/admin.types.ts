import type {
  Database,
  Json,
} from "../../../packages/db-types/src/database.types.js";

type CoreUserRow = Database["core"]["Tables"]["users"]["Row"];
type CoreUserWalletRow = Database["core"]["Tables"]["user_wallets"]["Row"];
type CurrencyLedgerRow =
  Database["economy"]["Tables"]["currency_ledger"]["Row"];
type UserBalanceRow = Database["economy"]["Tables"]["user_balances"]["Row"];
type DrawOrderRow = Database["gacha"]["Tables"]["draw_orders"]["Row"];
type DrawResultRow = Database["gacha"]["Tables"]["draw_results"]["Row"];
type ItemInstanceRow = Database["inventory"]["Tables"]["item_instances"]["Row"];
type MintQueueRow = Database["onchain"]["Tables"]["mint_queue"]["Row"];
type SupportTicketRow = Database["ops"]["Tables"]["support_tickets"]["Row"];
type StarOrderRow = Database["payments"]["Tables"]["star_orders"]["Row"];
type StarPaymentRow = Database["payments"]["Tables"]["star_payments"]["Row"];
type StarRefundRow = Database["payments"]["Tables"]["star_refunds"]["Row"];
type TelegramWebhookEventRow =
  Database["payments"]["Tables"]["telegram_webhook_events"]["Row"];
type ReconciliationRunRow =
  Database["economy"]["Tables"]["reconciliation_runs"]["Row"];
type RiskEventRow = Database["ops"]["Tables"]["risk_events"]["Row"];
type MarketListingRow = Database["market"]["Tables"]["listings"]["Row"];
type MarketPriceHealthRuleRow =
  Database["market"]["Tables"]["price_health_rules"]["Row"];
type CatalogMarketPriceRuleRow =
  Database["catalog"]["Tables"]["market_price_rules"]["Row"];
type CatalogCollectibleTemplateRow =
  Database["catalog"]["Tables"]["collectible_templates"]["Row"];
type CatalogCollectibleFormRow =
  Database["catalog"]["Tables"]["collectible_forms"]["Row"];
type AlbumBookRow = Database["album"]["Tables"]["books"]["Row"];
type AlbumMilestoneRow = Database["album"]["Tables"]["milestones"]["Row"];
type EconomyFeeRuleRow = Database["economy"]["Tables"]["fee_rules"]["Row"];
type ReferralRow = Database["tasks"]["Tables"]["referrals"]["Row"];
type UserTaskProgressRow =
  Database["tasks"]["Tables"]["user_task_progress"]["Row"];

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
  nextCursor?: string | null;
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

export type PaymentDetailRefund = Pick<
  StarRefundRow,
  | "id"
  | "star_payment_id"
  | "star_order_id"
  | "user_id"
  | "telegram_payment_charge_id"
  | "xtr_amount"
  | "status"
  | "reason"
  | "requested_by_admin_id"
  | "processed_at"
  | "metadata"
  | "created_at"
  | "updated_at"
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

export type PaymentDetailDiagnosticSeverity = "critical" | "warning" | "info";

export type PaymentDetailDiagnostic = {
  severity: PaymentDetailDiagnosticSeverity;
  code: string;
  message: string;
  related_id: string | null;
  suggested_action: string;
};

export type PaymentDetailResponse = {
  order: PaymentDetailOrder;
  user: PaymentDetailUser | null;
  payment: PaymentDetailPayment | null;
  refunds: PaymentDetailRefund[];
  drawOrder: PaymentDetailDrawOrder | null;
  drawResults: PaymentDetailDrawResult[];
  itemInstances: PaymentDetailItemInstance[];
  ledgerEntries: PaymentDetailLedgerEntry[];
  webhookEvents: PaymentDetailWebhookEvent[];
  diagnostics: PaymentDetailDiagnostic[];
  errorContext: PaymentDetailErrorContext | null;
  serverTime: string;
};

export type MonitoringStatus = "ok" | "warning" | "critical";

export type MonitoringWindow = {
  hours: number;
  startedAt: string;
  endedAt: string;
};

export type MonitoringSources = Record<
  string,
  number | string | boolean | null | undefined
>;

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

export type MonitoringMetricUnit =
  | "count"
  | "percent"
  | "milliseconds"
  | "stars"
  | "xtr"
  | "kcoin"
  | "fgems"
  | "currency"
  | "ratio"
  | string;

export type MonitoringBreakdownItem = {
  key: string;
  label?: string | null;
  value: number | string | null;
  unit?: MonitoringMetricUnit;
  status?: MonitoringStatus | string;
};

export type MonitoringGenericMetric = {
  key: string;
  label: string;
  value: number | string | null;
  unit: MonitoringMetricUnit;
  status: MonitoringStatus;
  description?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  previousValue?: number | string | null;
  breakdown?: MonitoringBreakdownItem[];
  meta?: Record<string, unknown>;
};

export type MonitoringMetricCollection =
  | MonitoringGenericMetric[]
  | Record<
      string,
      MonitoringGenericMetric | number | string | boolean | null | undefined
    >;

export type MonitoringException = {
  id: string;
  userId?: string;
  sourceType?: string | null;
  source_type?: string | null;
  sourceId?: string | null;
  source_id?: string | null;
  title?: string | null;
  message?: string | null;
  severity?: string | null;
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

export type PaymentSupportConfig = {
  configured: boolean;
  supportUrl: string | null;
  supportEmail: string | null;
  updatedAt: string | null;
  source: "system_settings" | "server_env" | "none";
};

export type MonitoringWarning = {
  code: string;
  severity: "warning";
  message: string;
  suggestedAction: string;
};

export type MonitoringAlertStatus =
  | "open"
  | "acknowledged"
  | "resolved"
  | "ignored"
  | string;

export type MonitoringAlert = {
  id: string;
  alertId?: string;
  alert_id?: string;
  alertType?: string;
  alert_type?: string;
  title?: string | null;
  message?: string | null;
  severity?: string | null;
  status: MonitoringAlertStatus;
  sourceType?: string | null;
  source_type?: string | null;
  sourceId?: string | null;
  source_id?: string | null;
  createdAt?: string;
  created_at?: string;
  acknowledgedAt?: string | null;
  acknowledged_at?: string | null;
  metadata?: Json;
};

export type UpdateAdminAlertAction =
  | "ack"
  | "acknowledge"
  | "acknowledged"
  | "resolve"
  | "resolved"
  | "ignore"
  | "ignored";

export type UpdateAdminAlertStatusInput = {
  alertId: string;
  action: UpdateAdminAlertAction;
  reason: string;
  resolutionResult?: string | null;
};

export type UpdateAdminAlertStatusResponse = AdminConfigMutationResponse & {
  alert_id?: string;
  alertId?: string;
  status?: string;
  previous_status?: string;
  previousStatus?: string;
};

export type MonitoringLinkedException = MonitoringException & {
  detail?: Json;
  metadata?: Json;
};

export type MonitoringDomainResponse = {
  window: MonitoringWindow;
  metrics?: MonitoringMetricCollection;
  summary?: Record<string, unknown>;
  alerts?: MonitoringAlert[];
  exceptions?: MonitoringLinkedException[];
  recentExceptions?:
    | MonitoringLinkedException[]
    | Record<string, MonitoringLinkedException[]>;
  warnings?: MonitoringWarning[];
  sources: MonitoringSources;
  serverTime: string;
};

export type BusinessMonitoringResponse = MonitoringDomainResponse;

export type EconomyMonitoringResponse = MonitoringDomainResponse;

export type GachaMonitoringResponse = MonitoringDomainResponse;

export type MarketMonitoringResponse = MonitoringDomainResponse;

export type MarketOpsStats = {
  activeListingCount: number;
  activeListingValueKcoin?: number | string | null;
  totalListingValueKcoin?: number | string | null;
  soldListingCount?: number;
  cancelledListingCount?: number;
  expiredListingCount?: number;
  volume24hKcoin: number | string;
  feeRevenueKcoin: number | string;
  abnormalListingCount: number;
  window?: {
    hours?: number | string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  };
  priceReferences?: MarketOpsPriceReference[];
  priceHealthFindings?: MarketOpsPriceHealthFinding[];
  suspiciousTradeGroups?: MarketOpsSuspiciousTradeGroup[];
  feeRevenueSources?: MarketOpsFeeRevenueSource[];
  statusCounts?: Record<string, number>;
  priceHealthCounts?: Record<string, number>;
  sources?: Record<string, unknown>;
  serverTime: string;
};

export type MarketOpsPriceReference = {
  templateId?: string | null;
  templateName?: string | null;
  templateSlug?: string | null;
  formId?: string | null;
  formName?: string | null;
  rarityCode?: string | null;
  floorPriceKcoin?: number | string | null;
  activeListingAvgPriceKcoin?: number | string | null;
  completedOrderAvgPriceKcoin?: number | string | null;
  lastSalePriceKcoin?: number | string | null;
  lastSaleOrderId?: string | null;
  lastSaleListingId?: string | null;
  lastSaleAt?: string | null;
  activeListingCount?: number | string | null;
  completedOrderCount?: number | string | null;
  saleCount24h?: number | string | null;
  snapshotAt?: string | null;
};

export type MarketOpsPriceHealthFinding = {
  listingId: string;
  status?: string | null;
  priceHealth?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  templateSlug?: string | null;
  formId?: string | null;
  formName?: string | null;
  rarityCode?: string | null;
  unitPriceKcoin?: number | string | null;
  floorPriceKcoin?: number | string | null;
  referencePriceKcoin?: number | string | null;
  ratioBps?: number | string | null;
  ruleId?: string | null;
  ruleSummary?: string | null;
  reason?: string | null;
  detectedAt?: string | null;
};

export type MarketOpsSuspiciousTradeGroup = {
  id?: string | null;
  riskEventId?: string | null;
  status?: string | null;
  sellerUserId?: string | null;
  buyerUserId?: string | null;
  orderCount?: number | string | null;
  listingCount?: number | string | null;
  totalVolumeKcoin?: number | string | null;
  sharedDeviceCount?: number | string | null;
  sharedWalletCount?: number | string | null;
  sharedIpHashCount?: number | string | null;
  evidenceSummary?: string | null;
  detectedAt?: string | null;
  relatedListingIds?: string[];
  relatedOrderIds?: string[];
};

export type MarketOpsFeeRevenueSource = {
  source: string;
  sourceLabel?: string | null;
  currencyCode?: string | null;
  amountKcoin?: number | string | null;
  orderCount?: number | string | null;
  settlementCount?: number | string | null;
  ledgerEntryCount?: number | string | null;
  status?: string | null;
  updatedAt?: string | null;
};

export type MarketListingAdminItem = {
  id: MarketListingRow["id"];
  status: MarketListingRow["status"];
  sellerUserId?: MarketListingRow["seller_user_id"] | null;
  sellerTelegramId?: number | string | null;
  templateId: MarketListingRow["template_id"];
  templateName?: string | null;
  templateSlug?: string | null;
  formId?: MarketListingRow["form_id"];
  formName?: string | null;
  rarityCode: MarketListingRow["rarity_code"];
  itemCount: MarketListingRow["item_count"];
  remainingCount: MarketListingRow["remaining_count"];
  unitPriceKcoin: MarketListingRow["unit_price_kcoin"];
  totalPriceKcoin?: number | string | null;
  feeBps: MarketListingRow["fee_bps"];
  feeAmountKcoin?: number | string | null;
  expectedNetAmount: MarketListingRow["expected_net_amount"];
  priceHealth?: MarketListingRow["price_health"];
  abnormalReasons?: string[];
  anomalyType?: string | null;
  anomalyTypes?: string[] | null;
  lockWarning?: string | null;
  lockStatus?: string | null;
  expiresAt?: MarketListingRow["expires_at"];
  lastPriceChangedAt?: MarketListingRow["last_price_changed_at"];
  createdAt: MarketListingRow["created_at"];
  updatedAt: MarketListingRow["updated_at"];
};

export type MarketPriceRule = {
  id: CatalogMarketPriceRuleRow["id"];
  templateId?: CatalogMarketPriceRuleRow["template_id"];
  formIndex?: CatalogMarketPriceRuleRow["form_index"];
  rarityCode?: CatalogMarketPriceRuleRow["rarity_code"];
  minPriceKcoin: CatalogMarketPriceRuleRow["min_price_kcoin"];
  maxPriceKcoin?: CatalogMarketPriceRuleRow["max_price_kcoin"];
  suggestedPriceKcoin?: CatalogMarketPriceRuleRow["suggested_price_kcoin"];
  active: CatalogMarketPriceRuleRow["active"];
  metadata: CatalogMarketPriceRuleRow["metadata"];
  createdAt: CatalogMarketPriceRuleRow["created_at"];
  updatedAt: CatalogMarketPriceRuleRow["updated_at"];
};

export type MarketHealthRule = {
  id: MarketPriceHealthRuleRow["id"];
  templateId?: MarketPriceHealthRuleRow["template_id"];
  formId?: string | null;
  formIndex?: number | string | null;
  formName?: string | null;
  rarityCode?: MarketPriceHealthRuleRow["rarity_code"];
  minRatioToFloor: MarketPriceHealthRuleRow["min_ratio_to_floor"];
  maxRatioToFloor: MarketPriceHealthRuleRow["max_ratio_to_floor"];
  lowBps?: number | string | null;
  highBps?: number | string | null;
  active: MarketPriceHealthRuleRow["active"];
  metadata: MarketPriceHealthRuleRow["metadata"];
  createdAt: MarketPriceHealthRuleRow["created_at"];
  updatedAt: MarketPriceHealthRuleRow["updated_at"];
};

export type MarketFeeRule = {
  id: EconomyFeeRuleRow["id"];
  code: EconomyFeeRuleRow["code"];
  feeType: EconomyFeeRuleRow["fee_type"];
  currencyCode: EconomyFeeRuleRow["currency_code"];
  feeBps: EconomyFeeRuleRow["fee_bps"];
  minFee: EconomyFeeRuleRow["min_fee"];
  maxFee?: EconomyFeeRuleRow["max_fee"];
  startsAt?: EconomyFeeRuleRow["starts_at"];
  endsAt?: EconomyFeeRuleRow["ends_at"];
  active: EconomyFeeRuleRow["active"];
  metadata: EconomyFeeRuleRow["metadata"];
  createdAt: EconomyFeeRuleRow["created_at"];
  updatedAt: EconomyFeeRuleRow["updated_at"];
};

export type MarketAdminListingsResponse = {
  items: MarketListingAdminItem[];
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

export type MarketPriceRulesResponse = {
  items: MarketPriceRule[];
  feeRules?: MarketFeeRule[];
  fee_rules?: MarketFeeRule[];
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

export type MarketHealthRulesResponse = {
  items: MarketHealthRule[];
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

export type MarketFeeRulesResponse = {
  items: MarketFeeRule[];
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

export type ForceCancelMarketListingInput = {
  listingId: string;
  reason: string;
};

export type UpsertMarketPriceRuleInput = {
  id?: string | null;
  templateId?: string | null;
  rarityCode?: string | null;
  formIndex?: number | null;
  minPriceKcoin: number;
  maxPriceKcoin?: number | null;
  suggestedPriceKcoin?: number | null;
  active: boolean;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type UpsertMarketHealthRuleInput = {
  id?: string | null;
  templateId?: string | null;
  formId?: string | null;
  rarityCode?: string | null;
  lowBps: number;
  highBps: number;
  active: boolean;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type UpsertMarketFeeRuleInput = {
  id?: string | null;
  code?: string | null;
  feeBps: number;
  minFee?: number;
  maxFee?: number | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type MarketAdminMutationResponse = AdminConfigMutationResponse & {
  price_rule_id?: string;
  priceRuleId?: string;
  health_rule_id?: string;
  healthRuleId?: string;
  fee_rule_id?: string;
  feeRuleId?: string;
  risk_event_id?: string;
  riskEventId?: string;
  idempotent?: boolean;
  rule?: Record<string, unknown>;
  status?: string;
  serverTime?: string;
};

export type MarketStatsRebuildResponse = MarketAdminMutationResponse & {
  snapshot_at?: string | null;
  price_snapshot_count?: number | string | null;
  depth_snapshot_count?: number | string | null;
  price_health_update_count?: number | string | null;
  start_app_event_id?: string | null;
  end_app_event_id?: string | null;
  failure_risk_event_id?: string | null;
  duration_ms?: number | string | null;
  error?: string | null;
};

export type ForceCancelMarketListingResponse = AdminConfigMutationResponse & {
  listing_id?: string;
  listingId?: string;
  previous_status?: string;
  previousStatus?: string;
  status?: string;
};

export type MarketListingDetailItem = {
  id: string;
  itemInstanceId: string;
  status: string;
  soldOrderId?: string | null;
  soldAt?: string | null;
  createdAt?: string | null;
  itemStatus?: string | null;
  level?: number | null;
  power?: number | null;
  nftMintStatus?: string | null;
};

export type MarketListingDetailOrder = {
  id: string;
  status: string;
  itemCount: number;
  unitPriceKcoin: number | string;
  totalPriceKcoin: number | string;
  feeBps: number;
  feeAmountKcoin: number | string;
  sellerNetAmountKcoin: number | string;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type MarketListingDetailEvent = {
  id: string;
  eventType: string;
  createdAt?: string | null;
};

export type MarketListingAdminDetail = {
  id: string;
  status: string;
  templateId: string;
  formId?: string | null;
  rarityCode: string;
  itemCount: number;
  remainingCount: number;
  unitPriceKcoin: number | string;
  feeBps: number;
  expectedNetAmount: number | string;
  priceHealth?: string | null;
  expiresAt?: string | null;
  lastPriceChangedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  template?: {
    id: string;
    slug: string;
    displayName: string;
    rarityCode: string;
    typeCode: string;
    releaseStatus: string;
    tradeable: boolean;
  } | null;
  form?: {
    id: string;
    formIndex: number;
    formSlug: string;
    displayName: string;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
  } | null;
  items: MarketListingDetailItem[];
  orders: MarketListingDetailOrder[];
  events: MarketListingDetailEvent[];
  sources: Record<string, unknown>;
  serverTime: string;
};

export type AdminAlertsResponse = {
  items: MonitoringAlert[];
  summary: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

export type MonitoringResponse = {
  window: MonitoringWindow;
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
  paymentSupport: PaymentSupportConfig;
  warnings: MonitoringWarning[];
  sources: MonitoringSources;
  serverTime: string;
};

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskEventStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "ignored"
  | "fixed"
  | "false_positive"
  | "escalated";

export type ResolveRiskEventStatus =
  | "reviewing"
  | "ignored"
  | "fixed"
  | "false_positive"
  | "escalated"
  | "resolved";

export type UserFlagLevel = "info" | "warning" | "restriction" | "ban";

export type RiskEvent = Pick<
  RiskEventRow,
  | "id"
  | "user_id"
  | "event_type"
  | "severity"
  | "status"
  | "source_type"
  | "source_id"
  | "score_delta"
  | "detail"
  | "resolved_by_admin_id"
  | "resolved_at"
  | "created_at"
> & {
  risk_event_id?: string;
  riskEventId?: string;
  associations?: RiskAssociation[];
  userId?: string | null;
  eventType?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  scoreDelta?: number | string | null;
  resolvedByAdminId?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
};

export type RiskAssociation = {
  kind: string;
  label: string;
  sourceType?: string;
  source_type?: string;
  sourceId?: string;
  source_id?: string;
  routeKey?: string | null;
  route_key?: string | null;
  summary?: Record<string, unknown>;
};

export type UserFlag = {
  id: string;
  user_id: string;
  userId?: string;
  flag_code: string;
  flagCode?: string;
  flag_level: UserFlagLevel | string;
  flagLevel?: UserFlagLevel | string;
  reason: string | null;
  active: boolean;
  starts_at: string;
  startsAt?: string;
  ends_at: string | null;
  endsAt?: string | null;
  created_by_admin_id: string | null;
  createdByAdminId?: string | null;
  metadata?: unknown;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
};

export type RiskUserSummary = {
  id: string;
  telegram_user_id?: number | string;
  telegramUserId?: number | string;
  username?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
  status: string;
  risk_score?: number | string | null;
  riskScore?: number | string | null;
  referred_by_user_id?: string | null;
  referredByUserId?: string | null;
  last_seen_at?: string | null;
  lastSeenAt?: string | null;
  last_auth_at?: string | null;
  lastAuthAt?: string | null;
  created_at?: string;
  createdAt?: string;
  metadata?: unknown;
};

export type RiskDeviceSummary = {
  id?: string;
  deviceHash?: string | null;
  device_hash?: string | null;
  deviceLast4?: string | null;
  device_last4?: string | null;
  ipHash?: string | null;
  ip_hash?: string | null;
  platform?: string | null;
  userAgentHash?: string | null;
  user_agent_hash?: string | null;
  firstSeenAt?: string | null;
  first_seen_at?: string | null;
  lastSeenAt?: string | null;
  last_seen_at?: string | null;
  createdAt?: string;
  created_at?: string;
  expiresAt?: string;
  expires_at?: string;
  revoked?: boolean;
  metadata?: unknown;
};

export type RiskUserProfile = {
  user: RiskUserSummary;
  devices: Record<string, unknown> & {
    deviceCount?: number;
    device_count?: number;
    sessionCount?: number;
    session_count?: number;
    ipHashCount?: number;
    ip_hash_count?: number;
    recentIpHashes?: string[];
    recent_ip_hashes?: string[];
    recentDeviceHashes?: string[];
    recent_device_hashes?: string[];
    devices?: RiskDeviceSummary[];
    sessions?: RiskDeviceSummary[];
    items?: RiskDeviceSummary[];
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
  };
  flags: {
    active?: UserFlag[];
    recent?: UserFlag[];
    items?: UserFlag[];
    totalCount?: number;
    total_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
  };
  wallets: Record<string, unknown> & {
    count?: number;
    totalCount?: number;
    total_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
    addressReuseCount?: number;
    address_reuse_count?: number;
    items?: Array<Record<string, unknown>>;
  };
  payments: Record<string, unknown> & {
    totalCount?: number;
    total_count?: number;
    successCount?: number;
    success_count?: number;
    failedCount?: number;
    failed_count?: number;
    failureRate?: number;
    failure_rate?: number;
    disputedCount?: number;
    disputed_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
    statusCounts?: Record<string, number>;
    status_counts?: Record<string, number>;
    recent?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
  };
  market: Record<string, unknown> & {
    buyerCount?: number;
    buyer_count?: number;
    sellerCount?: number;
    seller_count?: number;
    totalCount?: number;
    total_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
    statusCounts?: Record<string, number>;
    status_counts?: Record<string, number>;
    topCounterparties?: Array<Record<string, unknown>>;
    top_counterparties?: Array<Record<string, unknown>>;
    recent?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
  };
  referrals: Record<string, unknown> & {
    invitedCount?: number;
    invited_count?: number;
    invitedByCount?: number;
    invited_by_count?: number;
    totalCount?: number;
    total_count?: number;
    firstOpenCount?: number;
    first_open_count?: number;
    firstOpenConversionRate?: number;
    first_open_conversion_rate?: number;
    qualifiedCount?: number;
    qualified_count?: number;
    rewardedCount?: number;
    rewarded_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
    statusCounts?: Record<string, number>;
    status_counts?: Record<string, number>;
    asInviter?: Array<Record<string, unknown>>;
    as_inviter?: Array<Record<string, unknown>>;
    asInvitee?: Array<Record<string, unknown>>;
    as_invitee?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
  };
  riskEvents: {
    items?: RiskEvent[];
    recent?: RiskEvent[];
    totalCount?: number;
    total_count?: number;
    pageCount?: number;
    page_count?: number;
    nextCursor?: string | null;
    next_cursor?: string | null;
  };
  serverTime: string;
};

export type RiskUserProfileSection =
  | "devices"
  | "flags"
  | "payments"
  | "market"
  | "referrals"
  | "wallets"
  | "riskEvents";

export type RiskUserProfileParams = {
  section?: RiskUserProfileSection;
  cursor?: string | null;
  limit?: number;
};

export type RiskEventFilters = {
  severity?: RiskSeverity | "";
  status?: RiskEventStatus | "";
  eventType?: string;
  userId?: string;
  sourceId?: string;
  sourceType?: string;
  from?: string;
  to?: string;
  sort?: "severity" | "created_at";
  cursor?: string | null;
  limit?: number;
};

export type RiskEventsResponse = {
  items: RiskEvent[];
  summary: Record<string, unknown> & {
    totalCount?: number;
    total_count?: number;
    pageCount?: number;
    page_count?: number;
    criticalCount?: number;
    critical_count?: number;
    bySeverity?: Record<string, number>;
    byStatus?: Record<string, number>;
  };
  nextCursor: string | null;
  serverTime: string;
};

export type ResolveRiskEventInput = {
  riskEventId: string;
  status: ResolveRiskEventStatus;
  reason: string;
  resolutionDetail?: Record<string, unknown>;
  fixMethod?: string;
  escalationOwner?: string;
  escalationTicketId?: string;
};

export type ApplyUserFlagInput = {
  userId: string;
  flagCode: string;
  flagLevel?: UserFlagLevel;
  reason: string;
  endsAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type ClearUserFlagInput = {
  userFlagId?: string;
  userId?: string;
  flagCode?: string;
  reason: string;
};

export type RiskMutationResponse = Record<string, unknown> & {
  audit_log_id?: string | null;
  auditLogId?: string | null;
  idempotent?: boolean;
  serverTime: string;
};

export type ReconciliationRunType =
  | "payment"
  | "ledger"
  | "market"
  | "inventory"
  | "gacha"
  | "referral"
  | "mint"
  | "wallet";

export type ReconciliationJobType =
  | "payment_fulfillment"
  | "ledger_balance"
  | "market_settlement"
  | "inventory_lock"
  | "gacha_stock"
  | "referral_commission"
  | "mint_queue"
  | "wallet_sync";

export type ReconciliationFindingSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type ReconciliationFindingStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "ignored"
  | "fixed"
  | "false_positive"
  | "escalated";

export type ResolveReconciliationFindingStatus =
  | "ignored"
  | "fixed"
  | "false_positive"
  | "escalated"
  | "reviewing";

export type ReconciliationRun = Pick<
  ReconciliationRunRow,
  | "id"
  | "run_type"
  | "status"
  | "started_at"
  | "finished_at"
  | "result"
  | "error_message"
  | "created_by"
> & {
  runId?: string;
  runType?: ReconciliationRunType | ReconciliationJobType | string;
  finding_count?: number;
  findingCount?: number;
  critical_count?: number;
  criticalCount?: number;
  risk_event_count?: number;
  riskEventCount?: number;
  risk_event_inserted_count?: number;
  riskEventInsertedCount?: number;
  risk_event_existing_count?: number;
  riskEventExistingCount?: number;
  risk_event_skipped_count?: number;
  riskEventSkippedCount?: number;
  checked_count?: number;
  checkedCount?: number;
  elapsed_ms?: number;
  elapsedMs?: number;
  severity_counts?: Partial<Record<ReconciliationFindingSeverity, number>>;
  severityCounts?: Partial<Record<ReconciliationFindingSeverity, number>>;
  dry_run?: boolean;
  dryRun?: boolean;
};

export type ReconciliationFinding = {
  id?: string;
  risk_event_id?: string | null;
  riskEventId?: string | null;
  event_type?: RiskEventRow["event_type"];
  code?: string;
  message?: string;
  severity: RiskEventRow["severity"] | ReconciliationFindingSeverity;
  status?: RiskEventRow["status"] | ReconciliationFindingStatus;
  source_type?: RiskEventRow["source_type"];
  sourceType?: string | null;
  source_id?: RiskEventRow["source_id"];
  sourceId?: string | null;
  user_id?: RiskEventRow["user_id"];
  userId?: string | null;
  detail?: RiskEventRow["detail"] | Json;
  created_at?: RiskEventRow["created_at"];
  createdAt?: string;
  resolved_at?: RiskEventRow["resolved_at"];
  resolvedAt?: string | null;
  resolved_by_admin_id?: RiskEventRow["resolved_by_admin_id"];
  resolvedByAdminId?: string | null;
  reconciliation_run_id?: string | null;
  reconciliationRunId?: string | null;
  reconciliation_run_type?:
    | ReconciliationRunType
    | ReconciliationJobType
    | string
    | null;
  reconciliationRunType?:
    | ReconciliationRunType
    | ReconciliationJobType
    | string
    | null;
  star_order_id?: string | null;
  starOrderId?: string | null;
  draw_order_id?: string | null;
  drawOrderId?: string | null;
  payment_charge_id?: string | null;
  paymentChargeId?: string | null;
  mint_queue_id?: string | null;
  mintQueueId?: string | null;
  tx_hash?: string | null;
  txHash?: string | null;
  suggested_action?: string | null;
  suggestedAction?: string | null;
  dry_run?: boolean;
  dryRun?: boolean;
};

export type ReconciliationSummary = {
  latestRun?: ReconciliationRun | null;
  latest_run?: ReconciliationRun | null;
  totalRuns?: number;
  total_runs?: number;
  findingCount?: number;
  finding_count?: number;
  criticalCount?: number;
  critical_count?: number;
  riskEventCount?: number;
  risk_event_count?: number;
  checkedCount?: number;
  checked_count?: number;
  dryRunCount?: number;
  dry_run_count?: number;
};

export type ReconciliationResponse = {
  summary?: ReconciliationSummary;
  runs?: ReconciliationRun[];
  findings?: ReconciliationFinding[];
  checkedCount?: number;
  findingCount?: number;
  criticalCount?: number;
  riskEventCount?: number;
  elapsedMs?: number;
  startedAt?: string;
  finishedAt?: string;
  limit?: number;
  nextCursor: string | null;
  serverTime: string;
  requestId?: string;
  dryRun?: boolean;
  dry_run?: boolean;
  writeRiskEvents?: boolean;
  write_risk_events?: boolean;
};

export type ReconciliationRunsResponse = ReconciliationResponse & {
  items?: ReconciliationRun[];
  runs?: ReconciliationRun[];
};

export type ReconciliationFindingsResponse = ReconciliationResponse & {
  items?: ReconciliationFinding[];
  findings?: ReconciliationFinding[];
};

export type RunReconciliationInput = {
  runTypes: ReconciliationRunType[];
  limit?: number;
  dryRun?: boolean;
  reason: string;
  confirmationTarget?: string;
  confirmationCode?: string;
};

export type WorkerJobName =
  | "reconciliation"
  | "market_stats"
  | "leaderboard"
  | "retry_payments"
  | "retry_mints"
  | "expire_listings"
  | "campaign_close"
  | "cleanup_idempotency";

export type WorkerRunStatus =
  | "running"
  | "success"
  | "partial_failed"
  | "failed"
  | "skipped"
  | "already_running";

export type WorkerJob = {
  jobName?: WorkerJobName;
  job_name: WorkerJobName;
  label: string;
  description: string;
  cronPath?: string;
  cron_path: string;
  schedule: string;
  nextRunHint?: string;
  next_run_hint: string;
  enabled: boolean;
  disabledReason?: string | null;
  disabled_reason: string | null;
  flags: Array<{
    key: string;
    enabled: boolean;
    source: string;
    envName?: string;
  }>;
  lastRun?: WorkerRun | null;
  last_run: WorkerRun | null;
};

export type WorkerRun = {
  id?: string;
  jobName?: WorkerJobName;
  job_name: WorkerJobName;
  label?: string;
  requestId?: string;
  request_id: string;
  triggeredBy?: string;
  triggered_by: string;
  triggeredByAdminUserId?: string | null;
  triggered_by_admin_user_id: string | null;
  idempotencyKey?: string | null;
  idempotency_key: string | null;
  status: WorkerRunStatus;
  startedAt?: string;
  started_at: string;
  finishedAt?: string | null;
  finished_at: string | null;
  processedCount?: number;
  processed_count: number;
  failedCount?: number;
  failed_count: number;
  errorMessage?: string | null;
  error_message: string | null;
  params?: unknown;
  result?: unknown;
  metadata?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type WorkerRunResponse = {
  jobs: WorkerJob[];
  items: WorkerRun[];
  runs: WorkerRun[];
  summary: Record<string, number>;
  nextCursor?: string | null;
  next_cursor?: string | null;
  pageEnabled?: boolean;
  page_enabled?: boolean;
  disabledReason?: string | null;
  disabled_reason?: string | null;
  serverTime: string;
};

export type RunWorkerNowInput = {
  jobName: WorkerJobName;
  params?: Record<string, unknown>;
  reason: string;
};

export type ToggleWorkerInput = {
  jobName: WorkerJobName;
  enabled: boolean;
  reason: string;
};

export type ResolveReconciliationFindingInput = {
  findingId: string;
  status: ResolveReconciliationFindingStatus;
  reason: string;
  resolutionDetail?: Record<string, unknown>;
  fixMethod?: string;
  escalationOwner?: string;
  escalationTicketId?: string;
  confirmationTarget?: string;
  confirmationCode?: string;
};

export type ResolveReconciliationFindingResponse = {
  risk_event_id: string;
  riskEventId?: string;
  status: ReconciliationFindingStatus | string;
  previous_status?: ReconciliationFindingStatus | string;
  previousStatus?: ReconciliationFindingStatus | string;
  audit_log_id?: string;
  auditLogId?: string;
  resolved_at?: string | null;
  resolvedAt?: string | null;
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

export type CollectibleAdminForm = {
  id: CatalogCollectibleFormRow["id"];
  template_id: CatalogCollectibleFormRow["template_id"];
  form_index: CatalogCollectibleFormRow["form_index"];
  form_slug: CatalogCollectibleFormRow["form_slug"];
  display_name: CatalogCollectibleFormRow["display_name"];
  image_url: CatalogCollectibleFormRow["image_url"];
  thumbnail_url: CatalogCollectibleFormRow["thumbnail_url"];
  avatar_url: CatalogCollectibleFormRow["avatar_url"];
  is_default: CatalogCollectibleFormRow["is_default"];
  next_form_id: CatalogCollectibleFormRow["next_form_id"];
  updated_at: CatalogCollectibleFormRow["updated_at"];
};

export type CollectibleAdminItem = {
  id: CatalogCollectibleTemplateRow["id"];
  slug: CatalogCollectibleTemplateRow["slug"];
  display_name: CatalogCollectibleTemplateRow["display_name"];
  subtitle: CatalogCollectibleTemplateRow["subtitle"];
  description: CatalogCollectibleTemplateRow["description"];
  rarity_code: CatalogCollectibleTemplateRow["rarity_code"];
  type_code: CatalogCollectibleTemplateRow["type_code"];
  series_id: CatalogCollectibleTemplateRow["series_id"];
  faction_id: CatalogCollectibleTemplateRow["faction_id"];
  base_power: CatalogCollectibleTemplateRow["base_power"];
  max_level: CatalogCollectibleTemplateRow["max_level"];
  supply_limit: CatalogCollectibleTemplateRow["supply_limit"];
  release_status: CatalogCollectibleTemplateRow["release_status"];
  tradeable: CatalogCollectibleTemplateRow["tradeable"];
  upgradeable: CatalogCollectibleTemplateRow["upgradeable"];
  evolvable: CatalogCollectibleTemplateRow["evolvable"];
  decomposable: CatalogCollectibleTemplateRow["decomposable"];
  nft_mintable: CatalogCollectibleTemplateRow["nft_mintable"];
  sort_order: CatalogCollectibleTemplateRow["sort_order"];
  metadata?: Json;
  created_at: CatalogCollectibleTemplateRow["created_at"];
  updated_at: CatalogCollectibleTemplateRow["updated_at"];
  forms: CollectibleAdminForm[];
  media_counts: Record<string, number>;
};

export type CollectiblesAdminResponse = {
  items: CollectibleAdminItem[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type AlbumMilestoneAdminItem = {
  id: AlbumMilestoneRow["id"];
  book_id: AlbumMilestoneRow["book_id"];
  required_count: AlbumMilestoneRow["required_count"];
  title: AlbumMilestoneRow["title"];
  reward: AlbumMilestoneRow["reward"];
  active: AlbumMilestoneRow["active"];
  sort_order: AlbumMilestoneRow["sort_order"];
  metadata?: Json;
  created_at: AlbumMilestoneRow["created_at"];
  updated_at: AlbumMilestoneRow["updated_at"];
};

export type AlbumBookAdminItem = {
  id: AlbumBookRow["id"];
  code: AlbumBookRow["code"];
  display_name: AlbumBookRow["display_name"];
  description: AlbumBookRow["description"];
  book_type: AlbumBookRow["book_type"];
  series_id: AlbumBookRow["series_id"];
  faction_id: AlbumBookRow["faction_id"];
  rarity_code: AlbumBookRow["rarity_code"];
  cover_url: AlbumBookRow["cover_url"];
  active: AlbumBookRow["active"];
  starts_at: AlbumBookRow["starts_at"];
  ends_at: AlbumBookRow["ends_at"];
  sort_order: AlbumBookRow["sort_order"];
  metadata?: Json;
  created_at: AlbumBookRow["created_at"];
  updated_at: AlbumBookRow["updated_at"];
  item_count: number;
  milestones: AlbumMilestoneAdminItem[];
};

export type AlbumAdminResponse = {
  items: AlbumBookAdminItem[];
  summary?: Record<string, number>;
  nextCursor: string | null;
  serverTime: string;
};

export type ReportMetricValue = string | number | boolean | null | Json;

export type ReportMetrics = Record<string, ReportMetricValue>;

export type ReportFilterOptions = {
  campaigns?: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
  }>;
  blindBoxes?: Array<{
    id: string;
    slug: string;
    displayName: string;
    status: string;
  }>;
  series?: Array<{
    id: string;
    slug: string;
    displayName: string;
    status: string;
  }>;
  rarities?: Array<{
    code: string;
    displayName: string;
    sortOrder?: number | string | null;
  }>;
  templates?: Array<{
    id: string;
    slug: string;
    displayName: string;
    rarityCode: string;
    seriesId?: string | null;
    releaseStatus?: string | null;
  }>;
  currencies?: Array<{
    code: string;
    displayName: string;
    symbol?: string | null;
  }>;
  cohorts?: Array<{
    key: string;
    label: string;
  }>;
};

export type DailyBusinessReport = {
  id: string;
  report_date: string;
  campaign_id: string | null;
  box_id: string | null;
  cohort_key: string;
  scope_key: string;
  metrics: ReportMetrics;
};

export type DailyEconomyReport = {
  id: string;
  report_date: string;
  currency_code: string;
  source_type: string;
  cohort_key: string;
  scope_key: string;
  metrics: ReportMetrics;
};

export type DailyGachaReport = {
  id: string;
  report_date: string;
  campaign_id: string | null;
  box_id: string | null;
  series_id: string | null;
  template_id: string | null;
  rarity_code: string;
  cohort_key: string;
  scope_key: string;
  metrics: ReportMetrics;
};

export type DailyMarketReport = {
  id: string;
  report_date: string;
  series_id: string | null;
  template_id: string | null;
  rarity_code: string;
  cohort_key: string;
  scope_key: string;
  metrics: ReportMetrics;
};

export type DailyReferralReport = {
  id: string;
  report_date: string;
  campaign_id: string | null;
  cohort_key: string;
  scope_key: string;
  metrics: ReportMetrics;
};

export type ReportFilters = {
  from?: string;
  to?: string;
  campaignId?: string;
  boxId?: string;
  seriesId?: string;
  templateId?: string;
  rarityCode?: string;
  cohortKey?: string;
  currencyCode?: string;
  limit?: number;
  cursor?: string | number | null;
};

export type DailyReportsResponse = {
  items: DailyBusinessReport[];
  businessReports?: DailyBusinessReport[];
  referralReports: DailyReferralReport[];
  filterOptions?: ReportFilterOptions;
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  sources?: Record<string, unknown>;
  serverTime: string;
};

export type EconomyReportsResponse = {
  items: DailyEconomyReport[];
  filterOptions?: ReportFilterOptions;
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  sources?: Record<string, unknown>;
  serverTime: string;
};

export type GachaReportsResponse = {
  items: DailyGachaReport[];
  filterOptions?: ReportFilterOptions;
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  sources?: Record<string, unknown>;
  serverTime: string;
};

export type MarketReportsResponse = {
  items: DailyMarketReport[];
  filterOptions?: ReportFilterOptions;
  summary?: Record<string, unknown>;
  nextCursor: string | null;
  sources?: Record<string, unknown>;
  serverTime: string;
};

export type ReportExportType = "daily" | "gacha" | "economy" | "market";

export type ReportExportInput = {
  reportType: ReportExportType;
  filters: ReportFilters;
  reason: string;
  confirmLargeRange?: boolean;
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

export type UpdateCollectibleTemplateOpsInput = {
  id: string;
  release_status?: string;
  tradeable?: boolean;
  upgradeable?: boolean;
  evolvable?: boolean;
  decomposable?: boolean;
  nft_mintable?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
  reason: string;
};

export type UpdateAlbumMilestoneInput = {
  id: string;
  title?: string;
  required_count?: number;
  reward?: Array<{
    currency: "KCOIN" | "FGEMS";
    amount: number;
  }>;
  active?: boolean;
  sort_order?: number;
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

export type AdminPaginatedResponse<
  TItem,
  TSummary extends Record<string, unknown> = Record<string, unknown>,
> = {
  items: TItem[];
  summary: TSummary;
  nextCursor: string | null;
  serverTime: string;
};

export type AdminUserProfile = Pick<
  CoreUserRow,
  | "id"
  | "telegram_user_id"
  | "username"
  | "first_name"
  | "last_name"
  | "photo_url"
  | "language_code"
  | "status"
  | "risk_score"
  | "referred_by_user_id"
  | "last_seen_at"
  | "last_auth_at"
  | "first_seen_at"
  | "created_at"
  | "updated_at"
> & {
  telegramUserId?: number | string;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  languageCode?: string | null;
  riskScore?: number | string | null;
  referredByUserId?: string | null;
  lastSeenAt?: string | null;
  lastAuthAt?: string | null;
  firstSeenAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  displayName?: string | null;
  walletAddress?: string | null;
  latestWalletAddress?: string | null;
  latestPaymentOrderId?: string | null;
  latestSupportTicketId?: string | null;
  balanceSummary?: Record<string, number | string | null>;
  summary?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
};

export type AdminUserBalance = Pick<
  UserBalanceRow,
  | "user_id"
  | "currency_code"
  | "available_amount"
  | "locked_amount"
  | "total_earned"
  | "total_spent"
  | "total_locked"
  | "total_unlocked"
  | "updated_at"
  | "created_at"
> & {
  currencyCode?: string;
  availableAmount?: number | string;
  lockedAmount?: number | string;
  totalEarned?: number | string;
  totalSpent?: number | string;
  updatedAt?: string;
};

export type AdminUserLedgerEntry = Pick<
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
> & {
  currencyCode?: string;
  entryType?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceRef?: string | null;
  idempotencyKey?: string | null;
  createdAt?: string;
};

export type AdminUserInventoryItem = Pick<
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
  | "updated_at"
> & {
  ownerUserId?: string | null;
  templateId?: string;
  templateName?: string | null;
  formId?: string | null;
  formName?: string | null;
  rarityCode?: string | null;
  serialNo?: number | string;
  sourceType?: string | null;
  sourceId?: string | null;
  nftMintStatus?: string | null;
  mintedNftItemId?: string | null;
  acquiredAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserPaymentItem = Pick<
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
  | "paid_at"
  | "fulfilled_at"
  | "error_message"
  | "created_at"
  | "updated_at"
> & {
  businessType?: string;
  businessId?: string | null;
  xtrAmount?: number | string;
  invoicePayload?: string;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  errorMessage?: string | null;
  payment?: PaymentDetailPayment | null;
  refund?: PaymentDetailRefund | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserWallet = Pick<
  CoreUserWalletRow,
  | "id"
  | "user_id"
  | "chain"
  | "network"
  | "address"
  | "wallet_app_name"
  | "is_primary"
  | "status"
  | "verified_at"
  | "disconnected_at"
  | "last_sync_at"
  | "created_at"
  | "updated_at"
> & {
  walletAppName?: string | null;
  isPrimary?: boolean;
  verifiedAt?: string | null;
  disconnectedAt?: string | null;
  lastSyncAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown> | null;
};

export type AdminUserMarketListing = Pick<
  MarketListingRow,
  | "id"
  | "seller_user_id"
  | "status"
  | "template_id"
  | "form_id"
  | "rarity_code"
  | "item_count"
  | "remaining_count"
  | "unit_price_kcoin"
  | "expected_net_amount"
  | "price_health"
  | "created_at"
  | "updated_at"
> & {
  sellerUserId?: string;
  templateId?: string;
  templateName?: string | null;
  formId?: string | null;
  rarityCode?: string | null;
  itemCount?: number | string;
  remainingCount?: number | string;
  unitPriceKcoin?: number | string;
  expectedNetAmount?: number | string;
  priceHealth?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserTaskProgress = Pick<
  UserTaskProgressRow,
  | "id"
  | "user_id"
  | "task_id"
  | "status"
  | "period_key"
  | "progress_count"
  | "target_count"
  | "completed_at"
  | "claimed_at"
  | "created_at"
  | "updated_at"
> & {
  taskId?: string;
  taskTitle?: string | null;
  periodKey?: string;
  progressCount?: number | string;
  targetCount?: number | string;
  completedAt?: string | null;
  claimedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserReferral = Pick<
  ReferralRow,
  | "id"
  | "inviter_user_id"
  | "invitee_user_id"
  | "invite_code"
  | "status"
  | "first_open_order_id"
  | "qualified_at"
  | "rewarded_at"
  | "created_at"
  | "updated_at"
> & {
  role?: "inviter" | "invitee" | string;
  inviterUserId?: string;
  inviteeUserId?: string;
  inviteCode?: string;
  firstOpenOrderId?: string | null;
  qualifiedAt?: string | null;
  rewardedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserMintQueueItem = Pick<
  MintQueueRow,
  | "id"
  | "user_id"
  | "item_instance_id"
  | "template_id"
  | "form_id"
  | "wallet_id"
  | "status"
  | "priority"
  | "attempt_count"
  | "max_attempts"
  | "next_attempt_at"
  | "nft_item_id"
  | "tx_hash"
  | "error_message"
  | "created_at"
  | "updated_at"
  | "completed_at"
> & {
  itemInstanceId?: string;
  templateId?: string;
  formId?: string | null;
  walletId?: string | null;
  attemptCount?: number | string;
  maxAttempts?: number | string;
  nextAttemptAt?: string | null;
  nftItemId?: string | null;
  txHash?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

export type SupportTicketStatus =
  | "open"
  | "pending_user"
  | "pending_ops"
  | "resolved"
  | "rejected"
  | "escalated"
  | (string & {});

export type SupportTicket = Pick<
  SupportTicketRow,
  | "id"
  | "user_id"
  | "ticket_type"
  | "subject"
  | "message"
  | "status"
  | "assigned_admin_id"
  | "related_type"
  | "related_id"
  | "resolved_at"
  | "created_at"
  | "updated_at"
> & {
  status: SupportTicketStatus;
  userId?: string | null;
  ticketType?: string;
  assignedAdminId?: string | null;
  assignedAdminName?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  resolution?: string | null;
  resolutionResult?: string | null;
  rejectedReason?: string | null;
  escalationOwner?: string | null;
  escalationQueue?: string | null;
  statusReason?: string | null;
  lastHandledByAdminId?: string | null;
  lastHandledAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown> | null;
  metadataSummary?: Record<string, unknown> | null;
  compensationRequests?: CompensationRequest[];
};

export type CompensationRequestStatus =
  | "draft"
  | "requested"
  | "pending_approval"
  | "approved"
  | "executed"
  | "rejected"
  | "failed"
  | (string & {});

export type CompensationRequest = {
  id: string;
  targetUserId: string;
  ticketId?: string | null;
  compensationType: string;
  currencyCode?: string | null;
  amount?: number | string | null;
  itemTemplateId?: string | null;
  itemFormId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  status: CompensationRequestStatus;
  impactPreview?: Record<string, unknown>;
  approvalRequestId?: string | null;
  auditLogId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminUserDetail = {
  user: AdminUserProfile;
  balances: AdminUserBalance[];
  wallets: AdminUserWallet[];
  marketListings: AdminUserMarketListing[];
  taskProgress: AdminUserTaskProgress[];
  referrals?: AdminUserReferral[];
  mintQueue: AdminUserMintQueueItem[];
  riskEvents: RiskEvent[];
  flags: UserFlag[];
  supportTickets: SupportTicket[];
  compensationRequests?: CompensationRequest[];
  assets?: AdminDataBlock<AdminUserBalance>;
  payments?: AdminDataBlock<AdminUserPaymentItem>;
  gacha?: AdminDataBlock<Record<string, unknown>>;
  inventory?: AdminDataBlock<AdminUserInventoryItem>;
  market?: AdminDataBlock<AdminUserMarketListing>;
  tasks?: AdminDataBlock<Record<string, unknown>>;
  walletsBlock?: AdminDataBlock<AdminUserWallet>;
  wallets_block?: AdminDataBlock<AdminUserWallet>;
  mint?: AdminDataBlock<AdminUserMintQueueItem>;
  risk?: AdminDataBlock<Record<string, unknown>>;
  support?: AdminDataBlock<SupportTicket>;
  summary: Record<string, unknown>;
  sources: Record<string, unknown>;
  serverTime: string;
};

export type AdminDataBlock<TItem> = {
  dataSource?: string;
  data_source?: string;
  updatedAt?: string | null;
  updated_at?: string | null;
  count?: number;
  items?: TItem[];
  byStatus?: Record<string, number>;
  by_status?: Record<string, number>;
  [key: string]: unknown;
};

export type AdminUserProfilesResponse =
  AdminPaginatedResponse<AdminUserProfile>;

export type AdminUserLedgerResponse =
  AdminPaginatedResponse<AdminUserLedgerEntry>;

export type AdminUserInventoryResponse =
  AdminPaginatedResponse<AdminUserInventoryItem>;

export type AdminUserPaymentsResponse =
  AdminPaginatedResponse<AdminUserPaymentItem>;

export type SupportTicketsResponse = AdminPaginatedResponse<SupportTicket>;

export type CreateSupportTicketInput = {
  userId?: string | null;
  ticketType: string;
  subject: string;
  message?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  metadata?: Record<string, unknown>;
  reason?: string;
};

export type UpdateSupportTicketInput = {
  ticketId: string;
  status?: SupportTicketStatus;
  assignedAdminId?: string | null;
  resolution?: string | null;
  rejectionReason?: string | null;
  escalationOwner?: string | null;
  escalationQueue?: string | null;
  result?: Record<string, unknown>;
  reason: string;
};

export type CreateCompensationRequestInput = {
  targetUserId: string;
  ticketId?: string | null;
  compensationType: string;
  currencyCode?: string | null;
  amount?: number | null;
  itemTemplateId?: string | null;
  itemFormId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceTaskProgressId?: string | null;
  sourceTaskClaimId?: string | null;
  sourceTaskId?: string | null;
  sourceTaskPeriodKey?: string | null;
  sourceDrawOrderId?: string | null;
  sourceStarOrderId?: string | null;
  notificationTitle?: string | null;
  notificationBody?: string | null;
  impactPreview: Record<string, unknown>;
  reason: string;
};

export type SupportMutationResponse = AdminConfigMutationResponse & {
  ticketId?: string;
  ticket_id?: string;
  compensationRequestId?: string;
  compensation_request_id?: string;
  approvalRequestId?: string | null;
  approval_request_id?: string | null;
  status?: string;
};

export type AdminTab =
  | "monitoring"
  | "payments"
  | "reconciliation"
  | "workers"
  | "reports"
  | "risk"
  | "mint"
  | "market-ops"
  | "wallets"
  | "campaigns"
  | "collectibles"
  | "album"
  | "blind-boxes"
  | "gacha-pools"
  | "flags"
  | "danger"
  | "audit"
  | "users"
  | "support"
  | "admins"
  | "roles"
  | "permissions";

export type AdminPermissionMode = "all" | "any";
