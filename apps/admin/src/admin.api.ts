import type {
  AdminApiEnvelope,
  AuditLogFilters,
  AuditLogsResponse,
  AdminConfigMutationResponse,
  BlindBoxesAdminResponse,
  CampaignsResponse,
  AdminMeResponse,
  AdminRolesResponse,
  AdminUsersResponse,
  DropPoolDraftItemInput,
  DropPoolDraftPityRuleInput,
  DropPoolItemsResponse,
  DropPoolMutationResponse,
  DropPoolValidationResult,
  DropPoolVersionsResponse,
  FeatureFlagsResponse,
  MintQueueResponse,
  MonitoringResponse,
  PaymentAdminResponse,
  PityRulesResponse,
  UpdateBlindBoxStatusInput,
  UpsertBlindBoxInput,
  UpsertBoxPriceRuleInput,
  UpsertCampaignInput,
  WalletsResponse,
} from "./admin.types";

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

export async function fetchMonitoring(
  params: QueryParams = {},
): Promise<MonitoringResponse> {
  return adminRequest<MonitoringResponse>(
    `/api/admin/monitoring${toQueryString(params)}`,
  );
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
  return fetchBlindBoxAdminItems(params);
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

    throw new AdminApiError({
      code: errorPayload?.error?.code ?? "ADMIN_AUDIT_EXPORT_FAILED",
      message:
        errorPayload?.error?.message ?? `Request failed: ${response.status}`,
      status: response.status,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.requestId,
    });
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

  const response = await fetch(path, requestInit);
  const payload = await parseAdminPayload<T>(response);

  if (!response.ok || !payload || payload.ok !== true) {
    const errorPayload = payload?.ok === false ? payload : null;

    throw new AdminApiError({
      code: errorPayload?.error?.code ?? "ADMIN_API_ERROR",
      message:
        errorPayload?.error?.message ?? `Request failed: ${response.status}`,
      status: response.status,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.requestId,
    });
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
