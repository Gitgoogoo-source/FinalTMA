import type {
  AdminApiEnvelope,
  FeatureFlagsResponse,
  MintQueueResponse,
  MonitoringResponse,
  PaymentAdminResponse,
  WalletsResponse,
} from "./admin.types";

type QueryParams = Record<string, string | number | boolean | null | undefined>;

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
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
    headers: {
      "X-Admin-Confirm": "true",
      "X-Idempotency-Key": `admin-retry-mint:${input.mintQueueId}:${Date.now()}`,
    },
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

export async function updateFeatureFlag(input: {
  key: string;
  enabled: boolean;
  reason: string;
  description?: string | null;
}): Promise<Record<string, unknown>> {
  return adminRequest<Record<string, unknown>>("/api/admin/feature-flags", {
    method: "PATCH",
    headers: {
      "X-Admin-Confirm": "true",
      "X-Idempotency-Key": `admin-feature-flag:${input.key}:${input.enabled}:${Date.now()}`,
    },
    body: {
      key: input.key,
      enabled: input.enabled,
      reason: input.reason,
      description: input.description ?? undefined,
      confirm: true,
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
