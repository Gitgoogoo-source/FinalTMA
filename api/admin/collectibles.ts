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
  normalizeBoolean,
  normalizeRequiredText,
  normalizeRequiredUuid,
  parseAdminLimit,
  parseOffsetCursor,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
  type JsonRecord,
} from "./_shared.js";
import { assertReadSuccess, sanitizeAdminJson } from "./gacha/_shared.js";

type CollectibleTemplateRow = {
  id: string;
  slug: string;
  display_name: string;
  subtitle: string | null;
  description: string | null;
  rarity_code: string;
  type_code: string;
  series_id: string | null;
  faction_id: string | null;
  base_power: number;
  max_level: number;
  supply_limit: number | null;
  release_status: string;
  tradeable: boolean;
  upgradeable: boolean;
  evolvable: boolean;
  decomposable: boolean;
  nft_mintable: boolean;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type CollectibleFormRow = {
  id: string;
  template_id: string;
  form_index: number;
  form_slug: string;
  display_name: string;
  image_url: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
  is_default: boolean;
  next_form_id: string | null;
  updated_at: string;
};

type CollectibleMediaRow = {
  template_id: string;
  media_type: string;
};

type CollectibleMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

type CollectibleOpsInput = {
  templateId: string;
  releaseStatus?: string | undefined;
  tradeable?: boolean | undefined;
  upgradeable?: boolean | undefined;
  evolvable?: boolean | undefined;
  decomposable?: boolean | undefined;
  nftMintable?: boolean | undefined;
  sortOrder?: number | undefined;
  metadata?: ReturnType<typeof toJsonObject> | undefined;
};

const COLLECTIBLE_READ_PERMISSIONS = [
  "catalog:read",
  "gacha:read",
  "admin:read",
] as const;
const COLLECTIBLE_WRITE_PERMISSIONS = ["catalog:write", "admin:write"] as const;
const RELEASE_STATUSES = ["draft", "active", "hidden", "retired"] as const;
const TEMPLATE_COLUMNS = [
  "id",
  "slug",
  "display_name",
  "subtitle",
  "description",
  "rarity_code",
  "type_code",
  "series_id",
  "faction_id",
  "base_power",
  "max_level",
  "supply_limit",
  "release_status",
  "tradeable",
  "upgradeable",
  "evolvable",
  "decomposable",
  "nft_mintable",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req, _res, ctx) => {
    await assertApiRateLimit(req, _res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: [...COLLECTIBLE_READ_PERMISSIONS],
        requireAll: false,
      });

      return await listCollectibles(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: [...COLLECTIBLE_WRITE_PERMISSIONS],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const input = normalizeCollectibleOpsInput(body);

    try {
      const result = await callAdminWriteRpc<CollectibleMutationResult>({
        functionName: "admin_update_collectible_template_ops",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_template_id: input.templateId,
          p_release_status: input.releaseStatus,
          p_tradeable: input.tradeable,
          p_upgradeable: input.upgradeable,
          p_evolvable: input.evolvable,
          p_decomposable: input.decomposable,
          p_nft_mintable: input.nftMintable,
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
      throw mapAdminRpcError(error, "ADMIN_CATALOG_TEMPLATE_UPDATE_FAILED");
    }
  },
  {
    methods: ["GET", "PATCH"],
    rateLimit: false,
  },
);

async function listCollectibles(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const id = normalizeOptionalBodyUuid(queryInput.id, "id");
  const status = normalizeOptionalEnumQuery(
    queryInput.status,
    "status",
    RELEASE_STATUSES,
  );
  const q = firstQueryValue(queryInput.q);

  let query = db
    .schema("catalog")
    .from("collectible_templates")
    .select(TEMPLATE_COLUMNS);

  if (id) {
    query = query.eq("id", id);
  }

  if (status) {
    query = query.eq("release_status", status);
  }

  if (q) {
    const escaped = escapePostgrestLike(q);
    query = query.or(`slug.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_COLLECTIBLES_LOOKUP_FAILED",
    "Failed to load collectible templates.",
  );

  const rawRows = (data ?? []) as unknown as CollectibleTemplateRow[];
  const pageRows = rawRows.slice(0, limit);
  const templateIds = pageRows.map((row) => row.id);
  const forms = await loadForms(db, templateIds);
  const mediaCounts = await loadMediaCounts(db, templateIds);
  const items = pageRows.map((row) =>
    mapCollectibleRow(
      row,
      forms.get(row.id) ?? [],
      mediaCounts.get(row.id) ?? {},
    ),
  );

  return {
    items,
    summary: summarizeCollectibles(items),
    nextCursor: buildNextCursor(rawRows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

async function loadForms(
  db: SupabaseAdminClient,
  templateIds: string[],
): Promise<Map<string, CollectibleFormRow[]>> {
  const grouped = new Map<string, CollectibleFormRow[]>();

  if (templateIds.length === 0) {
    return grouped;
  }

  const { data, error } = await db
    .schema("catalog")
    .from("collectible_forms")
    .select(
      "id,template_id,form_index,form_slug,display_name,image_url,thumbnail_url,avatar_url,is_default,next_form_id,updated_at",
    )
    .in("template_id", templateIds)
    .order("form_index", { ascending: true });

  assertReadSuccess(
    error,
    "ADMIN_COLLECTIBLE_FORMS_LOOKUP_FAILED",
    "Failed to load collectible forms.",
  );

  for (const form of (data ?? []) as unknown as CollectibleFormRow[]) {
    const list = grouped.get(form.template_id) ?? [];
    list.push(form);
    grouped.set(form.template_id, list);
  }

  return grouped;
}

async function loadMediaCounts(
  db: SupabaseAdminClient,
  templateIds: string[],
): Promise<Map<string, Record<string, number>>> {
  const grouped = new Map<string, Record<string, number>>();

  if (templateIds.length === 0) {
    return grouped;
  }

  const { data, error } = await db
    .schema("catalog")
    .from("collectible_media")
    .select("template_id,media_type")
    .in("template_id", templateIds);

  assertReadSuccess(
    error,
    "ADMIN_COLLECTIBLE_MEDIA_LOOKUP_FAILED",
    "Failed to load collectible media.",
  );

  for (const media of (data ?? []) as unknown as CollectibleMediaRow[]) {
    const counts = grouped.get(media.template_id) ?? {};
    counts[media.media_type] = (counts[media.media_type] ?? 0) + 1;
    grouped.set(media.template_id, counts);
  }

  return grouped;
}

function mapCollectibleRow(
  row: CollectibleTemplateRow,
  forms: CollectibleFormRow[],
  mediaCounts: Record<string, number>,
) {
  return {
    ...row,
    base_power: Number(row.base_power),
    max_level: Number(row.max_level),
    supply_limit:
      row.supply_limit === null || row.supply_limit === undefined
        ? null
        : Number(row.supply_limit),
    sort_order: Number(row.sort_order),
    metadata: sanitizeAdminJson(row.metadata),
    forms: forms.map((form) => ({
      ...form,
      form_index: Number(form.form_index),
    })),
    media_counts: mediaCounts,
  };
}

function normalizeCollectibleOpsInput(body: JsonRecord): CollectibleOpsInput {
  const releaseStatus =
    body.release_status === undefined
      ? undefined
      : normalizeEnum(body.release_status, "release_status", RELEASE_STATUSES);

  return {
    templateId: normalizeRequiredUuid(body.id ?? body.template_id, "id"),
    releaseStatus,
    tradeable: normalizeOptionalBoolean(body.tradeable, "tradeable"),
    upgradeable: normalizeOptionalBoolean(body.upgradeable, "upgradeable"),
    evolvable: normalizeOptionalBoolean(body.evolvable, "evolvable"),
    decomposable: normalizeOptionalBoolean(body.decomposable, "decomposable"),
    nftMintable: normalizeOptionalBoolean(body.nft_mintable, "nft_mintable"),
    sortOrder:
      body.sort_order === undefined
        ? undefined
        : normalizeInteger(body.sort_order, "sort_order", { min: 0 }),
    metadata:
      body.metadata === undefined
        ? undefined
        : normalizeJsonObject(body.metadata, "metadata"),
  };
}

function normalizeOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  return value === undefined ? undefined : normalizeBoolean(value, field);
}

function normalizeJsonObject(
  value: unknown,
  field: string,
): ReturnType<typeof toJsonObject> {
  if (!isRecord(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an object`);
  }

  return toJsonObject(value);
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

function escapePostgrestLike(value: string): string {
  return value.replace(/[%_,]/g, (match) => `\\${match}`);
}

function summarizeCollectibles(rows: Array<{ release_status: string }>) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    summary[row.release_status] = (summary[row.release_status] ?? 0) + 1;
    return summary;
  }, {});
}
