import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  buildNextCursor,
  callAdminWriteRpc,
  firstQueryValue,
  isRecord,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  parseAdminLimit,
  parseOffsetCursor,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
  type JsonRecord,
} from "./_shared.js";
import {
  assertReadSuccess,
  sanitizeAdminJson,
  summarizeByStatus,
} from "./gacha/_shared.js";

type CampaignRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  image_url: string;
  placement: string;
  target_type: string;
  target_ref: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type CampaignMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

type CampaignInput = {
  id: string | null;
  code: string;
  title: string;
  description: string | null;
  imageUrl: string;
  placement: CampaignPlacement;
  targetType: CampaignTargetType;
  targetRef: string | null;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  metadata: ReturnType<typeof toJsonObject>;
};

const CAMPAIGN_READ_PERMISSIONS = [
  "campaigns:read",
  "catalog:read",
  "admin:read",
] as const;
const CAMPAIGN_WRITE_PERMISSIONS = [
  "campaigns:write",
  "catalog:write",
  "admin:write",
] as const;

const CAMPAIGN_PLACEMENTS = [
  "market_top",
  "task_top",
  "box_top",
  "home_top",
  "album_top",
] as const;
const CAMPAIGN_TARGET_TYPES = [
  "none",
  "box",
  "market_listing",
  "shop_product",
  "external_url",
  "task",
] as const;
const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;

type CampaignPlacement = (typeof CAMPAIGN_PLACEMENTS)[number];
type CampaignTargetType = (typeof CAMPAIGN_TARGET_TYPES)[number];
type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const CAMPAIGN_COLUMNS = [
  "id",
  "code",
  "title",
  "description",
  "image_url",
  "placement",
  "target_type",
  "target_ref",
  "status",
  "starts_at",
  "ends_at",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: [...CAMPAIGN_READ_PERMISSIONS],
        requireAll: false,
      });

      return await listCampaigns(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: [...CAMPAIGN_WRITE_PERMISSIONS],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 96 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const input = normalizeCampaignInput(body, {
      requireId: ctx.method === "PATCH",
    });

    try {
      const result = await callAdminWriteRpc<CampaignMutationResult>({
        functionName: "admin_upsert_banner_campaign",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_banner_campaign_id: input.id,
          p_code: input.code,
          p_title: input.title,
          p_description: input.description,
          p_image_url: input.imageUrl,
          p_placement: input.placement,
          p_target_type: input.targetType,
          p_target_ref: input.targetRef,
          p_status: input.status,
          p_starts_at: input.startsAt,
          p_ends_at: input.endsAt,
          p_sort_order: input.sortOrder,
          p_metadata: input.metadata,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_BANNER_CAMPAIGN_UPSERT_FAILED");
    }
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function listCampaigns(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const id = normalizeOptionalBodyUuid(queryInput.id, "id");
  const placement = normalizeOptionalEnumQuery(
    queryInput.placement,
    "placement",
    CAMPAIGN_PLACEMENTS,
  );
  const status = normalizeOptionalEnumQuery(
    queryInput.status,
    "status",
    CAMPAIGN_STATUSES,
  );
  const q = firstQueryValue(queryInput.q);

  let query = db
    .schema("catalog")
    .from("banner_campaigns")
    .select(CAMPAIGN_COLUMNS);

  if (id) {
    query = query.eq("id", id);
  }

  if (placement) {
    query = query.eq("placement", placement);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (q) {
    const escaped = escapePostgrestLike(q);
    query = query.or(`code.ilike.%${escaped}%,title.ilike.%${escaped}%`);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_CAMPAIGNS_LOOKUP_FAILED",
    "Failed to load banner campaigns.",
  );

  const rows = ((data ?? []) as unknown as CampaignRow[]).map(mapCampaignRow);
  const pageRows = rows.slice(0, limit);

  return {
    items: pageRows,
    summary: summarizeByStatus(pageRows),
    nextCursor: buildNextCursor(rows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

function normalizeCampaignInput(
  body: JsonRecord,
  options: { requireId: boolean },
): CampaignInput {
  const id = normalizeOptionalBodyUuid(body.id, "id");

  if (options.requireId && !id) {
    throw new ApiError(400, "VALIDATION_FAILED", "id is required");
  }

  const startsAt = normalizeNullableIsoDateTime(body.starts_at, "starts_at");
  const endsAt = normalizeNullableIsoDateTime(body.ends_at, "ends_at");

  assertValidTimeWindow(startsAt, endsAt);

  return {
    id: id ?? null,
    code: normalizeCampaignCode(body.code, "code"),
    title: normalizeRequiredText(body.title, "title"),
    description: normalizeOptionalText(body.description) ?? null,
    imageUrl: normalizeImageUrl(body.image_url, "image_url"),
    placement: normalizeEnum(body.placement, "placement", CAMPAIGN_PLACEMENTS),
    targetType: normalizeEnum(
      body.target_type,
      "target_type",
      CAMPAIGN_TARGET_TYPES,
    ),
    targetRef: normalizeOptionalText(body.target_ref) ?? null,
    status: normalizeEnum(body.status, "status", CAMPAIGN_STATUSES),
    startsAt,
    endsAt,
    sortOrder: normalizeInteger(body.sort_order, "sort_order"),
    metadata: normalizeJsonObject(body.metadata),
  };
}

function mapCampaignRow(row: CampaignRow): CampaignRow {
  return {
    ...row,
    sort_order: Number(row.sort_order),
    metadata: sanitizeAdminJson(row.metadata),
  };
}

function normalizeOptionalBodyUuid(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeRequiredUuid(value, field);
}

function normalizeOptionalEnumQuery<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowedValues: T,
): T[number] | undefined {
  const raw = firstQueryValue(value);
  return raw ? normalizeEnum(raw, field, allowedValues) : undefined;
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowedValues: T,
): T[number] {
  const normalized = normalizeRequiredText(value, field).toLowerCase();

  if (!(allowedValues as readonly string[]).includes(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be one of: ${allowedValues.join(", ")}`,
    );
  }

  return normalized as T[number];
}

function normalizeCampaignCode(value: unknown, field: string): string {
  const normalized = normalizeRequiredText(value, field);

  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must start and end with a lowercase letter or number and contain only lowercase letters, numbers, _, or -`,
    );
  }

  return normalized;
}

function normalizeImageUrl(value: unknown, field: string): string {
  const normalized = normalizeRequiredText(value, field);

  if (!/^(https?:\/\/\S+|\/\S+)$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be an http(s) URL or an absolute path`,
    );
  }

  return normalized;
}

function normalizeNullableIsoDateTime(
  value: unknown,
  field: string,
): string | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const time = Date.parse(normalized);

  if (!Number.isFinite(time)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid ISO datetime`,
    );
  }

  return new Date(time).toISOString();
}

function assertValidTimeWindow(
  startsAt: string | null,
  endsAt: string | null,
): void {
  if (!startsAt || !endsAt) {
    return;
  }

  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "starts_at must be before ends_at",
    );
  }
}

function normalizeInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(normalized)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an integer`);
  }

  if (bounds.min !== undefined && normalized < bounds.min) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be >= ${bounds.min}`,
    );
  }

  if (bounds.max !== undefined && normalized > bounds.max) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be <= ${bounds.max}`,
    );
  }

  return normalized;
}

function normalizeJsonObject(value: unknown): ReturnType<typeof toJsonObject> {
  return toJsonObject(isRecord(value) ? value : {});
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[%*,()]/g, "");
}
