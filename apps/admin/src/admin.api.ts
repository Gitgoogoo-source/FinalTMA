import type {
  AdminApiEnvelope,
  AdminAlertsResponse,
  AdminStoragePublishedAsset,
  AdminStoragePreview,
  AdminStorageSignedUpload,
  AdminStorageTargetBucket,
  UpdateAdminAlertStatusInput,
  UpdateAdminAlertStatusResponse,
  AuditLogFilters,
  AuditLogsResponse,
  AdminConfigMutationResponse,
  BlindBoxesAdminResponse,
  BusinessMonitoringResponse,
  CampaignsResponse,
  AdminMeResponse,
  AdminRolesResponse,
  AdminUsersResponse,
  AdminUserDetail,
  AdminUserInventoryResponse,
  AdminUserLedgerResponse,
  AdminUserPaymentsResponse,
  AdminUserProfilesResponse,
  DropPoolDraftItemInput,
  DropPoolDraftPityRuleInput,
  DropPoolItemsResponse,
  DropPoolMutationResponse,
  DropPoolValidationResult,
  DropPoolVersionsResponse,
  EconomyMonitoringResponse,
  FeatureFlagsResponse,
  GachaMonitoringResponse,
  ForceCancelMarketListingInput,
  ForceCancelMarketListingResponse,
  MarketAdminListingsResponse,
  MarketListingAdminDetail,
  MarketAdminMutationResponse,
  MarketFeeRulesResponse,
  MarketHealthRulesResponse,
  MarketMonitoringResponse,
  MarketOpsStats,
  MarketPriceRulesResponse,
  MarketStatsRebuildResponse,
  MintQueueResponse,
  MonitoringResponse,
  PaymentAdminResponse,
  PaymentDetailResponse,
  PaymentSupportConfig,
  PityRulesResponse,
  ApplyUserFlagInput,
  ClearUserFlagInput,
  CreateCompensationRequestInput,
  CreateSupportTicketInput,
  ReconciliationFindingsResponse,
  ReconciliationRunsResponse,
  ReconciliationResponse,
  ResolveRiskEventInput,
  ResolveReconciliationFindingResponse,
  ResolveReconciliationFindingInput,
  RiskEventFilters,
  RiskEventsResponse,
  RiskMutationResponse,
  RiskUserProfileParams,
  RiskUserProfile,
  UpdateBlindBoxStatusInput,
  UpsertBlindBoxInput,
  UpsertBoxPriceRuleInput,
  UpsertCampaignInput,
  RunReconciliationInput,
  SupportMutationResponse,
  SupportTicketsResponse,
  UpdateSupportTicketInput,
  UpsertMarketFeeRuleInput,
  UpsertMarketHealthRuleInput,
  UpsertMarketPriceRuleInput,
  WalletsResponse,
} from "./admin.types";
import { reportAdminApiError, reportAdminUnknownError } from "./observability";

type QueryParams = Record<string, string | number | boolean | null | undefined>;

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
};
export type AdminCsvExportResult = {
  auditLogId: string | null;
  blob: Blob;
  filename: string;
};
export type AdminDangerAction =
  | "compensate_asset"
  | "ban_user"
  | "request_refund"
  | "release_inventory_lock"
  | "publish_drop_pool_version";

export type AdminDangerOperationInput = {
  action: AdminDangerAction;
  targetId: string;
  reason: string;
  payload: Record<string, unknown>;
  approvalContext?: Record<string, unknown>;
};

export type RefundAssetHandlingStrategy =
  | "keep"
  | "freeze"
  | "reclaim"
  | "manual_review";

export type CreateRefundRecordInput = {
  starPaymentId: string;
  starOrderId: string;
  reason: string;
  xtrAmount: number;
  status: "requested" | "processing" | "completed" | "rejected" | "failed";
  externalTicketId?: string | null;
  assetHandlingStrategy?: RefundAssetHandlingStrategy;
  assetHandlingNote?: string | null;
  riskRestrictionRequired?: boolean;
  riskRestrictionReason?: string | null;
};

export type CreateRefundRecordResponse = AdminConfigMutationResponse & {
  star_order_id?: string;
  star_payment_id?: string;
  star_refund_id?: string;
  status?: string;
  order_status?: string | null;
  xtr_amount?: number | string;
  refund_context?: Record<string, unknown>;
  external_ticket_id?: string | null;
  asset_handling_strategy?: RefundAssetHandlingStrategy;
  risk_restriction_required?: boolean;
  external_refund_completed?: boolean;
};

export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(input.message);
    this.name = "AdminApiError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

export async function fetchAdminMe(): Promise<AdminMeResponse> {
  return adminRequest<AdminMeResponse>("/api/admin/me");
}

export async function fetchAdminUsers(
  params: QueryParams = {},
): Promise<AdminUsersResponse> {
  return adminRequest<AdminUsersResponse>(
    `/api/admin/admin-users${toQueryString(params)}`,
  );
}

export async function fetchAppUsers(
  params: QueryParams = {},
): Promise<AdminUserProfilesResponse> {
  return adminRequest<AdminUserProfilesResponse>(
    `/api/admin/users${toQueryString(params)}`,
  );
}

export async function fetchAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail> {
  return adminRequest<AdminUserDetail>(
    `/api/admin/users/detail${toQueryString({ userId })}`,
  );
}

export async function fetchAdminUserLedger(
  params: QueryParams & { userId: string },
): Promise<AdminUserLedgerResponse> {
  return adminRequest<AdminUserLedgerResponse>(
    `/api/admin/users/ledger${toQueryString(params)}`,
  );
}

export async function fetchAdminUserInventory(
  params: QueryParams & { userId: string },
): Promise<AdminUserInventoryResponse> {
  return adminRequest<AdminUserInventoryResponse>(
    `/api/admin/users/inventory${toQueryString(params)}`,
  );
}

export async function fetchAdminUserPayments(
  params: QueryParams & { userId: string },
): Promise<AdminUserPaymentsResponse> {
  return adminRequest<AdminUserPaymentsResponse>(
    `/api/admin/users/payments${toQueryString(params)}`,
  );
}

export async function fetchSupportTickets(
  params: QueryParams = {},
): Promise<SupportTicketsResponse> {
  return adminRequest<SupportTicketsResponse>(
    `/api/admin/support/tickets${toQueryString(params)}`,
  );
}

export async function createSupportTicket(
  input: CreateSupportTicketInput,
): Promise<SupportMutationResponse> {
  return adminRequest<SupportMutationResponse>("/api/admin/support/tickets", {
    method: "POST",
    headers: buildDangerHeaders(
      "admin-create-support-ticket",
      input.relatedId ?? input.userId ?? input.subject,
    ),
    body: {
      userId: input.userId ?? undefined,
      ticketType: input.ticketType,
      subject: input.subject,
      message: input.message ?? undefined,
      relatedType: input.relatedType ?? undefined,
      relatedId: input.relatedId ?? undefined,
      metadata: input.metadata,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function updateSupportTicket(
  input: UpdateSupportTicketInput,
): Promise<SupportMutationResponse> {
  return adminRequest<SupportMutationResponse>("/api/admin/support/tickets", {
    method: "PATCH",
    headers: buildDangerHeaders(
      "admin-update-support-ticket",
      `${input.ticketId}:${input.status ?? input.assignedAdminId ?? "update"}`,
    ),
    body: {
      ticketId: input.ticketId,
      status: input.status,
      assignedAdminId: input.assignedAdminId,
      resolution: input.resolution ?? undefined,
      rejectionReason: input.rejectionReason ?? undefined,
      escalationOwner: input.escalationOwner ?? undefined,
      escalationQueue: input.escalationQueue ?? undefined,
      result: input.result,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function createCompensationRequest(
  input: CreateCompensationRequestInput,
): Promise<SupportMutationResponse> {
  const target = [
    input.targetUserId,
    input.compensationType,
    input.currencyCode ?? input.itemTemplateId ?? input.ticketId ?? "request",
  ].join(":");

  return adminRequest<SupportMutationResponse>(
    "/api/admin/support/create-compensation-request",
    {
      method: "POST",
      headers: buildDangerHeaders("admin-create-compensation-request", target),
      body: {
        targetUserId: input.targetUserId,
        ticketId: input.ticketId ?? undefined,
        compensationType: input.compensationType,
        currencyCode: input.currencyCode ?? undefined,
        amount: input.amount ?? undefined,
        itemTemplateId: input.itemTemplateId ?? undefined,
        itemFormId: input.itemFormId ?? undefined,
        sourceType: input.sourceType ?? undefined,
        sourceId: input.sourceId ?? undefined,
        sourceTaskProgressId: input.sourceTaskProgressId ?? undefined,
        sourceTaskClaimId: input.sourceTaskClaimId ?? undefined,
        sourceTaskId: input.sourceTaskId ?? undefined,
        sourceTaskPeriodKey: input.sourceTaskPeriodKey ?? undefined,
        sourceDrawOrderId: input.sourceDrawOrderId ?? undefined,
        sourceStarOrderId: input.sourceStarOrderId ?? undefined,
        notificationTitle: input.notificationTitle ?? undefined,
        notificationBody: input.notificationBody ?? undefined,
        impactPreview: input.impactPreview,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function fetchAdminRoles(
  params: QueryParams = {},
): Promise<AdminRolesResponse> {
  return adminRequest<AdminRolesResponse>(
    `/api/admin/roles${toQueryString(params)}`,
  );
}

export async function fetchPayments(
  params: QueryParams = {},
): Promise<PaymentAdminResponse> {
  return adminRequest<PaymentAdminResponse>(
    `/api/admin/payments${toQueryString(params)}`,
  );
}

export async function fetchPaymentDetail(
  starOrderId: string,
): Promise<PaymentDetailResponse> {
  return adminRequest<PaymentDetailResponse>(
    `/api/admin/payment-detail${toQueryString({ starOrderId })}`,
  );
}

export async function fetchMonitoring(
  params: QueryParams = {},
): Promise<MonitoringResponse> {
  return adminRequest<MonitoringResponse>(
    `/api/admin/monitoring${toQueryString(params)}`,
  );
}

export async function fetchAdminAlerts(
  params: QueryParams = {},
): Promise<AdminAlertsResponse> {
  return adminRequest<AdminAlertsResponse>(
    `/api/admin/alerts${toQueryString(params)}`,
  );
}

export async function updateAdminAlertStatus(
  input: UpdateAdminAlertStatusInput,
): Promise<UpdateAdminAlertStatusResponse> {
  return adminRequest<UpdateAdminAlertStatusResponse>("/api/admin/alerts", {
    method: "PATCH",
    headers: buildDangerHeaders(
      "admin-update-alert-status",
      `${input.alertId}:${input.action}`,
    ),
    body: {
      alertId: input.alertId,
      action: input.action,
      reason: input.reason,
      resolutionResult: input.resolutionResult ?? undefined,
      confirm: true,
    },
  });
}

export async function fetchBusinessMonitoring(
  params: QueryParams = {},
): Promise<BusinessMonitoringResponse> {
  return adminRequest<BusinessMonitoringResponse>(
    `/api/admin/monitoring/business${toQueryString(params)}`,
  );
}

export async function fetchEconomyMonitoring(
  params: QueryParams = {},
): Promise<EconomyMonitoringResponse> {
  return adminRequest<EconomyMonitoringResponse>(
    `/api/admin/monitoring/economy${toQueryString(params)}`,
  );
}

export async function fetchGachaMonitoring(
  params: QueryParams = {},
): Promise<GachaMonitoringResponse> {
  return adminRequest<GachaMonitoringResponse>(
    `/api/admin/monitoring/gacha${toQueryString(params)}`,
  );
}

export async function fetchMarketMonitoring(
  params: QueryParams = {},
): Promise<MarketMonitoringResponse> {
  return adminRequest<MarketMonitoringResponse>(
    `/api/admin/monitoring/market${toQueryString(params)}`,
  );
}

export async function fetchMarketOpsStats(
  params: QueryParams = {},
): Promise<MarketOpsStats> {
  return adminRequest<MarketOpsStats>(
    `/api/admin/market/stats${toQueryString(params)}`,
  );
}

export async function fetchMarketAdminListings(
  params: QueryParams = {},
): Promise<MarketAdminListingsResponse> {
  return adminRequest<MarketAdminListingsResponse>(
    `/api/admin/market/listings${toQueryString(params)}`,
  );
}

export async function fetchMarketPriceRules(
  params: QueryParams = {},
): Promise<MarketPriceRulesResponse> {
  return adminRequest<MarketPriceRulesResponse>(
    `/api/admin/market/price-rules${toQueryString(params)}`,
  );
}

export async function fetchMarketHealthRules(
  params: QueryParams = {},
): Promise<MarketHealthRulesResponse> {
  return adminRequest<MarketHealthRulesResponse>(
    `/api/admin/market/health-rules${toQueryString(params)}`,
  );
}

export async function fetchMarketFeeRules(
  params: QueryParams = {},
): Promise<MarketFeeRulesResponse> {
  return adminRequest<MarketFeeRulesResponse>(
    `/api/admin/market/fee-rules${toQueryString(params)}`,
  );
}

export async function fetchMarketListingDetail(
  listingId: string,
): Promise<MarketListingAdminDetail> {
  return adminRequest<MarketListingAdminDetail>(
    `/api/admin/market${toQueryString({ listingId })}`,
  );
}

export async function upsertMarketPriceRule(
  input: UpsertMarketPriceRuleInput,
): Promise<MarketAdminMutationResponse> {
  return adminRequest<MarketAdminMutationResponse>(
    "/api/admin/market/price-rules",
    {
      method: input.id ? "PATCH" : "POST",
      headers: buildDangerHeaders(
        "admin-market-price-rule",
        input.id ?? input.templateId ?? input.rarityCode ?? "global",
      ),
      body: {
        ...input,
        confirm: true,
      },
    },
  );
}

export async function upsertMarketHealthRule(
  input: UpsertMarketHealthRuleInput,
): Promise<MarketAdminMutationResponse> {
  return adminRequest<MarketAdminMutationResponse>(
    "/api/admin/market/health-rules",
    {
      method: input.id ? "PATCH" : "POST",
      headers: buildDangerHeaders(
        "admin-market-health-rule",
        input.id ??
          input.formId ??
          input.templateId ??
          input.rarityCode ??
          "global",
      ),
      body: {
        ...input,
        confirm: true,
      },
    },
  );
}

export async function upsertMarketFeeRule(
  input: UpsertMarketFeeRuleInput,
): Promise<MarketAdminMutationResponse> {
  return adminRequest<MarketAdminMutationResponse>(
    "/api/admin/market/fee-rules",
    {
      method: input.id ? "PATCH" : "POST",
      headers: buildDangerHeaders(
        "admin-market-fee-rule",
        input.id ?? input.code ?? "market-sell",
      ),
      body: {
        ...input,
        confirm: true,
      },
    },
  );
}

export async function rebuildMarketStats(input: {
  reason: string;
}): Promise<MarketStatsRebuildResponse> {
  return adminRequest<MarketStatsRebuildResponse>(
    "/api/admin/market/rebuild-stats",
    {
      method: "POST",
      headers: buildDangerHeaders("admin-rebuild-market-stats", "market-stats"),
      body: {
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function forceCancelMarketListing(
  input: ForceCancelMarketListingInput,
): Promise<ForceCancelMarketListingResponse> {
  return adminRequest<ForceCancelMarketListingResponse>(
    "/api/admin/market/force-cancel-listing",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-force-cancel-market-listing",
        input.listingId,
      ),
      body: {
        listingId: input.listingId,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function fetchPaymentSupportConfig(): Promise<
  PaymentSupportConfig & { serverTime: string }
> {
  return adminRequest<PaymentSupportConfig & { serverTime: string }>(
    "/api/admin/payment-support-config",
  );
}

export async function updatePaymentSupportConfig(input: {
  supportUrl: string | null;
  supportEmail: string | null;
  reason: string;
}): Promise<
  PaymentSupportConfig & {
    audit_log_id?: string | null;
    idempotent?: boolean;
    serverTime: string;
  }
> {
  return adminRequest<
    PaymentSupportConfig & {
      audit_log_id?: string | null;
      idempotent?: boolean;
      serverTime: string;
    }
  >("/api/admin/payment-support-config", {
    method: "PATCH",
    headers: buildDangerHeaders(
      "admin-payment-support-config",
      input.supportUrl ?? input.supportEmail ?? "clear",
    ),
    body: {
      supportUrl: input.supportUrl,
      supportEmail: input.supportEmail,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function fetchMintQueue(
  params: QueryParams = {},
): Promise<MintQueueResponse> {
  return adminRequest<MintQueueResponse>(
    `/api/admin/mint-queue${toQueryString(params)}`,
  );
}

export async function retryMintQueue(input: {
  mintQueueId: string;
  reason: string;
  priority: "LOW" | "NORMAL" | "HIGH";
}): Promise<Record<string, unknown>> {
  return adminRequest<Record<string, unknown>>("/api/admin/retry-mint", {
    method: "POST",
    headers: buildDangerHeaders("admin-retry-mint", input.mintQueueId),
    body: {
      mintQueueId: input.mintQueueId,
      priority: input.priority,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function retryPaymentFulfillment(input: {
  starOrderId: string;
  reason: string;
}): Promise<AdminConfigMutationResponse> {
  return adminRequest<AdminConfigMutationResponse>(
    "/api/admin/retry-payment-fulfillment",
    {
      method: "POST",
      headers: buildDangerHeaders("admin-retry-payment", input.starOrderId),
      body: {
        starOrderId: input.starOrderId,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function createRefundRecord(
  input: CreateRefundRecordInput,
): Promise<CreateRefundRecordResponse> {
  return adminRequest<CreateRefundRecordResponse>(
    "/api/admin/create-refund-record",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-create-refund-record",
        `${input.starOrderId}:${input.status}`,
      ),
      body: {
        starPaymentId: input.starPaymentId,
        starOrderId: input.starOrderId,
        reason: input.reason,
        xtrAmount: input.xtrAmount,
        status: input.status,
        refundContext: {
          externalTicketId: input.externalTicketId ?? null,
          assetHandlingStrategy: input.assetHandlingStrategy ?? "manual_review",
          assetHandlingNote: input.assetHandlingNote ?? null,
          riskRestrictionRequired: input.riskRestrictionRequired ?? false,
          riskRestrictionReason: input.riskRestrictionReason ?? null,
          externalRefundCompleted: false,
        },
        confirm: true,
      },
    },
  );
}

export async function fetchWallets(
  params: QueryParams = {},
): Promise<WalletsResponse> {
  return adminRequest<WalletsResponse>(
    `/api/admin/wallets${toQueryString(params)}`,
  );
}

export async function fetchFeatureFlags(
  params: QueryParams = {},
): Promise<FeatureFlagsResponse> {
  return adminRequest<FeatureFlagsResponse>(
    `/api/admin/feature-flags${toQueryString(params)}`,
  );
}

export async function fetchCampaigns(
  params: QueryParams = {},
): Promise<CampaignsResponse> {
  return adminRequest<CampaignsResponse>(
    `/api/admin/campaigns${toQueryString(params)}`,
  );
}

export async function upsertCampaign(
  input: UpsertCampaignInput,
): Promise<AdminConfigMutationResponse> {
  return adminRequest<AdminConfigMutationResponse>("/api/admin/campaigns", {
    method: "POST",
    headers: buildDangerHeaders(
      "admin-upsert-campaign",
      input.id ?? input.code,
    ),
    body: {
      ...input,
      confirm: true,
    },
  });
}

export async function fetchBlindBoxAdminItems(
  params: QueryParams = {},
): Promise<BlindBoxesAdminResponse> {
  return adminRequest<BlindBoxesAdminResponse>(
    `/api/admin/gacha/boxes${toQueryString(params)}`,
  );
}

export async function fetchBlindBoxes(
  params: QueryParams = {},
): Promise<BlindBoxesAdminResponse> {
  return adminRequest<BlindBoxesAdminResponse>(
    `/api/admin/blind-boxes${toQueryString(params)}`,
  );
}

export async function upsertBlindBox(
  input: UpsertBlindBoxInput,
): Promise<AdminConfigMutationResponse> {
  return adminRequest<AdminConfigMutationResponse>("/api/admin/blind-boxes", {
    method: "POST",
    headers: buildDangerHeaders(
      "admin-upsert-blind-box",
      input.id ?? input.slug,
    ),
    body: {
      ...input,
      confirm: true,
    },
  });
}

export async function updateBlindBoxStatus(
  input: UpdateBlindBoxStatusInput,
): Promise<AdminConfigMutationResponse> {
  return adminRequest<AdminConfigMutationResponse>("/api/admin/blind-boxes", {
    method: "PATCH",
    headers: buildDangerHeaders("admin-update-box-status", input.boxId),
    body: {
      action: "update_status",
      boxId: input.boxId,
      status: input.status,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function upsertBoxPriceRule(
  input: UpsertBoxPriceRuleInput,
): Promise<AdminConfigMutationResponse> {
  return adminRequest<AdminConfigMutationResponse>(
    "/api/admin/box-price-rules",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-upsert-box-price-rule",
        input.id ?? `${input.box_id}:${input.quantity}`,
      ),
      body: {
        ...input,
        confirm: true,
      },
    },
  );
}

export async function signAdminStorageUpload(input: {
  targetBucket: AdminStorageTargetBucket;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<AdminStorageSignedUpload> {
  return adminRequest<AdminStorageSignedUpload>(
    "/api/admin/storage/sign-upload",
    {
      method: "POST",
      body: input,
    },
  );
}

export async function uploadFileToSignedUrl(input: {
  signedUrl: string;
  file: File;
  cacheControl?: string;
}): Promise<void> {
  const formData = new FormData();
  formData.append("cacheControl", input.cacheControl ?? "31536000");
  formData.append("", input.file);

  const response = await fetch(input.signedUrl, {
    method: "PUT",
    body: formData,
  });

  if (!response.ok) {
    const error = new AdminApiError({
      code: "ADMIN_STORAGE_UPLOAD_FAILED",
      message: `Storage upload failed: ${response.status}`,
      status: response.status,
    });

    reportAdminApiError(error, {
      path: "admin-storage-signed-upload",
      method: "PUT",
    });
    throw error;
  }
}

export async function signAdminStoragePreview(input: {
  targetBucket: AdminStorageTargetBucket;
  tempPath: string;
}): Promise<AdminStoragePreview> {
  return adminRequest<AdminStoragePreview>("/api/admin/storage/sign-preview", {
    method: "POST",
    body: input,
  });
}

export async function publishAdminStorageUpload(input: {
  targetBucket: AdminStorageTargetBucket;
  tempPath: string;
  reason: string;
}): Promise<AdminStoragePublishedAsset> {
  return adminRequest<AdminStoragePublishedAsset>(
    "/api/admin/storage/publish-upload",
    {
      method: "POST",
      headers: buildDangerHeaders("admin-publish-storage", input.tempPath),
      body: {
        targetBucket: input.targetBucket,
        tempPath: input.tempPath,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function fetchDropPoolVersions(
  params: QueryParams = {},
): Promise<DropPoolVersionsResponse> {
  return adminRequest<DropPoolVersionsResponse>(
    `/api/admin/gacha/drop-pool-versions${toQueryString(params)}`,
  );
}

export async function fetchDropPoolItems(
  params: QueryParams = {},
): Promise<DropPoolItemsResponse> {
  return adminRequest<DropPoolItemsResponse>(
    `/api/admin/gacha/drop-pool-items${toQueryString(params)}`,
  );
}

export async function fetchPityRules(
  params: QueryParams = {},
): Promise<PityRulesResponse> {
  return adminRequest<PityRulesResponse>(
    `/api/admin/gacha/pity-rules${toQueryString(params)}`,
  );
}

export async function fetchAuditLogs(
  params: AuditLogFilters = {},
): Promise<AuditLogsResponse> {
  return adminRequest<AuditLogsResponse>(
    `/api/admin/audit-logs${toQueryString(params)}`,
  );
}

export async function fetchRiskEvents(
  params: RiskEventFilters = {},
): Promise<RiskEventsResponse> {
  return adminRequest<RiskEventsResponse>(
    `/api/admin/risk/events${toQueryString(params)}`,
  );
}

export async function fetchRiskUserProfile(
  userId: string,
  params: RiskUserProfileParams = {},
): Promise<RiskUserProfile> {
  return adminRequest<RiskUserProfile>(
    `/api/admin/risk/user-profile${toQueryString({ userId, ...params })}`,
  );
}

export async function resolveRiskEvent(
  input: ResolveRiskEventInput,
): Promise<RiskMutationResponse> {
  return adminRequest<RiskMutationResponse>("/api/admin/risk/resolve", {
    method: "PATCH",
    headers: buildDangerHeaders(
      "admin-resolve-risk-event",
      `${input.riskEventId}:${input.status}`,
    ),
    body: {
      riskEventId: input.riskEventId,
      status: input.status,
      reason: input.reason,
      resolutionDetail: input.resolutionDetail,
      fixMethod: input.fixMethod,
      escalationOwner: input.escalationOwner,
      escalationTicketId: input.escalationTicketId,
      confirm: true,
    },
  });
}

export async function applyUserFlag(
  input: ApplyUserFlagInput,
): Promise<RiskMutationResponse> {
  return adminRequest<RiskMutationResponse>("/api/admin/risk/apply-user-flag", {
    method: "POST",
    headers: buildDangerHeaders(
      "admin-apply-user-flag",
      `${input.userId}:${input.flagCode}`,
    ),
    body: {
      userId: input.userId,
      flagCode: input.flagCode,
      flagLevel: input.flagLevel ?? "restriction",
      reason: input.reason,
      endsAt: input.endsAt ?? undefined,
      metadata: input.metadata,
      confirm: true,
    },
  });
}

export async function clearUserFlag(
  input: ClearUserFlagInput,
): Promise<RiskMutationResponse> {
  const targetId =
    input.userFlagId ?? `${input.userId ?? "user"}:${input.flagCode ?? "flag"}`;

  return adminRequest<RiskMutationResponse>("/api/admin/risk/clear-user-flag", {
    method: "POST",
    headers: buildDangerHeaders("admin-clear-user-flag", targetId),
    body: {
      userFlagId: input.userFlagId,
      userId: input.userId,
      flagCode: input.flagCode,
      reason: input.reason,
      confirm: true,
    },
  });
}

export async function fetchReconciliationRuns(
  params: QueryParams = {},
): Promise<ReconciliationRunsResponse> {
  return adminRequest<ReconciliationRunsResponse>(
    `/api/admin/reconciliation/runs${toQueryString(params)}`,
  );
}

export async function runReconciliationNow(
  input: RunReconciliationInput,
): Promise<ReconciliationResponse> {
  const dryRun = input.dryRun ?? true;
  const confirmationTarget =
    input.confirmationTarget ?? input.runTypes.join(",");

  return adminRequest<ReconciliationResponse>(
    "/api/admin/reconciliation/run-now",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-reconciliation-run-now",
        input.runTypes.join(","),
      ),
      body: {
        runTypes: input.runTypes,
        limit: input.limit,
        dryRun,
        writeRiskEvents: !dryRun,
        reason: input.reason,
        confirmationTarget,
        confirmationCode:
          input.confirmationCode ??
          buildAdminConfirmationCode(confirmationTarget),
        confirm: true,
      },
    },
  );
}

export async function fetchReconciliationFindings(
  params: QueryParams = {},
): Promise<ReconciliationFindingsResponse> {
  return adminRequest<ReconciliationFindingsResponse>(
    `/api/admin/reconciliation/findings${toQueryString(params)}`,
  );
}

export async function resolveReconciliationFinding(
  input: ResolveReconciliationFindingInput,
): Promise<ResolveReconciliationFindingResponse> {
  return adminRequest<ResolveReconciliationFindingResponse>(
    "/api/admin/reconciliation/resolve-finding",
    {
      method: "PATCH",
      headers: buildDangerHeaders(
        "admin-reconciliation-resolve-finding",
        `${input.findingId}:${input.status}`,
      ),
      body: {
        findingId: input.findingId,
        status: input.status,
        reason: input.reason,
        resolutionDetail: input.resolutionDetail,
        fixMethod: input.fixMethod,
        escalationOwner: input.escalationOwner,
        escalationTicketId: input.escalationTicketId,
        confirmationTarget: input.confirmationTarget ?? input.findingId,
        confirmationCode:
          input.confirmationCode ?? buildAdminConfirmationCode(input.findingId),
        confirm: true,
      },
    },
  );
}

export async function exportAuditLogsCsv(input: {
  filters: AuditLogFilters;
  reason: string;
}): Promise<AdminCsvExportResult> {
  const response = await fetch("/api/admin/audit-logs/export", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filters: input.filters,
      reason: input.reason,
    }),
  });

  if (!response.ok) {
    const payload = await parseAdminPayload<unknown>(response);
    const errorPayload = payload?.ok === false ? payload : null;

    const error = new AdminApiError({
      code: errorPayload?.error?.code ?? "ADMIN_AUDIT_EXPORT_FAILED",
      message:
        errorPayload?.error?.message ?? `Request failed: ${response.status}`,
      status: response.status,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.requestId,
    });

    reportAdminApiError(error, {
      path: "/api/admin/audit-logs/export",
      method: "POST",
    });
    throw error;
  }

  return {
    auditLogId: response.headers.get("x-audit-log-id"),
    blob: await response.blob(),
    filename:
      readFilenameFromContentDisposition(
        response.headers.get("content-disposition"),
      ) ?? "audit-logs.csv",
  };
}

export async function updateFeatureFlag(input: {
  key: string;
  enabled: boolean;
  reason: string;
  description?: string | null;
}): Promise<Record<string, unknown>> {
  return adminRequest<Record<string, unknown>>("/api/admin/feature-flags", {
    method: "PATCH",
    headers: buildDangerHeaders("admin-feature-flag", input.key),
    body: {
      key: input.key,
      enabled: input.enabled,
      reason: input.reason,
      description: input.description ?? undefined,
      confirm: true,
    },
  });
}

export async function saveDropPoolDraft(input: {
  boxId: string;
  dropPoolVersionId?: string;
  versionName?: string;
  items: DropPoolDraftItemInput[];
  pityRules?: DropPoolDraftPityRuleInput[];
  reason: string;
}): Promise<DropPoolMutationResponse> {
  const targetId = input.dropPoolVersionId ?? input.boxId;

  return adminRequest<DropPoolMutationResponse>(
    "/api/admin/gacha/drop-pool-versions",
    {
      method: "POST",
      headers: buildDangerHeaders("admin-save-drop-pool-draft", targetId),
      body: {
        boxId: input.boxId,
        dropPoolVersionId: input.dropPoolVersionId,
        versionName: input.versionName,
        items: input.items,
        pityRules: input.pityRules,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function cloneDropPoolVersion(input: {
  boxId: string;
  sourceVersionId: string;
  versionName?: string;
  reason: string;
}): Promise<DropPoolMutationResponse> {
  return adminRequest<DropPoolMutationResponse>(
    "/api/admin/gacha/drop-pool-versions",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-clone-drop-pool-version",
        input.sourceVersionId,
      ),
      body: {
        boxId: input.boxId,
        sourceVersionId: input.sourceVersionId,
        versionName: input.versionName,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function validateDropPoolVersion(input: {
  dropPoolVersionId: string;
  reason: string;
}): Promise<DropPoolValidationResult> {
  return adminRequest<DropPoolValidationResult>(
    "/api/admin/gacha/drop-pool-versions",
    {
      method: "PATCH",
      headers: buildDangerHeaders(
        "admin-validate-drop-pool",
        input.dropPoolVersionId,
      ),
      body: {
        action: "validate",
        dropPoolVersionId: input.dropPoolVersionId,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function publishDropPoolVersion(input: {
  dropPoolVersionId: string;
  startsAt?: string | null;
  reason: string;
}): Promise<DropPoolMutationResponse> {
  return adminRequest<DropPoolMutationResponse>(
    "/api/admin/gacha/publish-drop-pool",
    {
      method: "POST",
      headers: buildDangerHeaders(
        "admin-publish-drop-pool",
        input.dropPoolVersionId,
      ),
      body: {
        dropPoolVersionId: input.dropPoolVersionId,
        startsAt: input.startsAt ?? undefined,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function archiveDropPoolVersion(input: {
  dropPoolVersionId: string;
  reason: string;
}): Promise<DropPoolMutationResponse> {
  return adminRequest<DropPoolMutationResponse>(
    "/api/admin/gacha/drop-pool-versions",
    {
      method: "PATCH",
      headers: buildDangerHeaders(
        "admin-archive-drop-pool",
        input.dropPoolVersionId,
      ),
      body: {
        action: "archive",
        dropPoolVersionId: input.dropPoolVersionId,
        reason: input.reason,
        confirm: true,
      },
    },
  );
}

export async function runAdminDangerOperation(
  input: AdminDangerOperationInput,
): Promise<Record<string, unknown>> {
  return adminRequest<Record<string, unknown>>("/api/admin/danger-ops", {
    method: "POST",
    headers: buildDangerHeaders(input.action, input.targetId),
    body: {
      action: input.action,
      ...input.payload,
      reason: input.reason,
      confirm: true,
      approvalContext: input.approvalContext ?? {
        phase: "phase6_initial",
        approvalStatus: "not_required",
      },
    },
  });
}

async function adminRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, ...requestOptions } = options;
  const headers = new Headers(options.headers);

  if (body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    credentials: "include",
    ...requestOptions,
    headers,
  };

  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  let response: Response;

  try {
    response = await fetch(path, requestInit);
  } catch (error) {
    reportAdminUnknownError(error, {
      type: "admin_api_network_error",
      path,
      method: requestInit.method ?? "GET",
    });
    throw error;
  }

  const payload = await parseAdminPayload<T>(response);

  if (!response.ok || !payload || payload.ok !== true) {
    const errorPayload = payload?.ok === false ? payload : null;

    const error = new AdminApiError({
      code: errorPayload?.error?.code ?? "ADMIN_API_ERROR",
      message:
        errorPayload?.error?.message ?? `Request failed: ${response.status}`,
      status: response.status,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.requestId,
    });

    reportAdminApiError(error, {
      path,
      method: requestInit.method ?? "GET",
    });
    throw error;
  }

  return payload.data;
}

async function parseAdminPayload<T>(response: Response): Promise<
  | AdminApiEnvelope<T>
  | {
      ok: false;
      error?: {
        code?: string;
        message?: string;
        details?: unknown;
      };
      requestId?: string;
    }
  | null
> {
  const text = await response.text().catch(() => "");
  const contentType = response.headers.get("content-type") ?? "";
  const mayBeJson =
    contentType.includes("application/json") || text.trim().startsWith("{");

  if (!text || !mayBeJson) {
    return {
      ok: false,
      error: {
        code: "ADMIN_INVALID_RESPONSE",
        message: "Admin API did not return JSON.",
      },
    };
  }

  try {
    return JSON.parse(text) as AdminApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "ADMIN_INVALID_RESPONSE",
        message: "Admin API returned invalid JSON.",
      },
    };
  }
}

function toQueryString(params: QueryParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}

function buildDangerHeaders(
  action: string,
  targetId: string,
): Record<string, string> {
  return {
    "X-Admin-Confirm": "true",
    "X-Idempotency-Key": `${sanitizeIdempotencyPart(action)}:${sanitizeIdempotencyPart(
      targetId,
    )}:${createIdempotencySuffix()}`,
  };
}

function buildAdminConfirmationCode(value: string): string {
  const normalized = value.trim();

  if (normalized.length <= 8) {
    return normalized;
  }

  return normalized.slice(-6);
}

function sanitizeIdempotencyPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 48);
}

function createIdempotencySuffix(): string {
  return globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
}

function readFilenameFromContentDisposition(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);

  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}
