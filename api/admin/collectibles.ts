import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import type { JsonValue } from "../../packages/server/src/db/transactions.js";
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
  description: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
  base_power_bonus: number;
  is_default: boolean;
  next_form_id: string | null;
  metadata: unknown;
  updated_at: string;
};

type CollectibleMediaRow = {
  id: string;
  template_id: string;
  form_id: string | null;
  media_type: string;
  url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  metadata: unknown;
  created_at: string;
};

type CollectibleMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

type CollectibleOpsInput = {
  templateId?: string | undefined;
  template: ReturnType<typeof toJsonObject>;
  forms?: JsonValue | undefined;
  media?: JsonValue | undefined;
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
        functionName: "admin_upsert_collectible_template",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_template_id: input.templateId,
          p_template: input.template,
          p_forms: input.forms,
          p_media: input.media,
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
    methods: ["GET", "PATCH", "POST"],
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
  const media = await loadMedia(db, templateIds);
  const items = pageRows.map((row) =>
    mapCollectibleRow(
      row,
      forms.get(row.id) ?? [],
      media.get(row.id) ?? [],
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
      "id,template_id,form_index,form_slug,display_name,description,image_url,thumbnail_url,avatar_url,base_power_bonus,is_default,next_form_id,metadata,updated_at",
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

async function loadMedia(
  db: SupabaseAdminClient,
  templateIds: string[],
): Promise<Map<string, CollectibleMediaRow[]>> {
  const grouped = new Map<string, CollectibleMediaRow[]>();

  if (templateIds.length === 0) {
    return grouped;
  }

  const { data, error } = await db
    .schema("catalog")
    .from("collectible_media")
    .select(
      "id,template_id,form_id,media_type,url,storage_bucket,storage_path,mime_type,width,height,sort_order,metadata,created_at",
    )
    .in("template_id", templateIds)
    .order("sort_order", { ascending: true });

  assertReadSuccess(
    error,
    "ADMIN_COLLECTIBLE_MEDIA_LOOKUP_FAILED",
    "Failed to load collectible media.",
  );

  for (const media of (data ?? []) as unknown as CollectibleMediaRow[]) {
    const list = grouped.get(media.template_id) ?? [];
    list.push(media);
    grouped.set(media.template_id, list);
  }

  return grouped;
}

function mapCollectibleRow(
  row: CollectibleTemplateRow,
  forms: CollectibleFormRow[],
  media: CollectibleMediaRow[],
) {
  const mediaCounts = media.reduce<Record<string, number>>((counts, item) => {
    counts[item.media_type] = (counts[item.media_type] ?? 0) + 1;
    return counts;
  }, {});

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
      base_power_bonus: Number(form.base_power_bonus),
      metadata: sanitizeAdminJson(form.metadata),
    })),
    media: media.map((item) => ({
      ...item,
      width:
        item.width === null || item.width === undefined
          ? null
          : Number(item.width),
      height:
        item.height === null || item.height === undefined
          ? null
          : Number(item.height),
      sort_order: Number(item.sort_order),
      metadata: sanitizeAdminJson(item.metadata),
    })),
    media_counts: mediaCounts,
  };
}

function normalizeCollectibleOpsInput(body: JsonRecord): CollectibleOpsInput {
  const templateId = normalizeOptionalBodyUuid(
    body.id ?? body.template_id,
    "id",
  );
  const template: JsonRecord = {};

  if (templateId) template.id = templateId;
  copyTextField(template, body, "slug", { required: true });
  copyTextField(template, body, "display_name", { required: true });
  copyTextField(template, body, "subtitle", { nullable: true });
  copyTextField(template, body, "description", { nullable: true });
  copyTextField(template, body, "rarity_code", { required: true });
  copyTextField(template, body, "type_code", { required: true });
  copyUuidField(template, body, "series_id");
  copyUuidField(template, body, "faction_id");
  copyIntegerField(template, body, "base_power", { min: 0 });
  copyIntegerField(template, body, "max_level", { min: 1 });
  copyIntegerField(template, body, "supply_limit", {
    min: 0,
    nullable: true,
  });

  if (body.release_status !== undefined) {
    template.release_status = normalizeEnum(
      body.release_status,
      "release_status",
      RELEASE_STATUSES,
    );
  }

  copyBooleanField(template, body, "tradeable");
  copyBooleanField(template, body, "upgradeable");
  copyBooleanField(template, body, "evolvable");
  copyBooleanField(template, body, "decomposable");
  copyBooleanField(template, body, "nft_mintable");
  copyIntegerField(template, body, "sort_order", { min: 0 });

  if (body.metadata !== undefined) {
    template.metadata = normalizeJsonObject(body.metadata, "metadata");
  }

  return {
    templateId,
    template: toJsonObject(template),
    forms:
      body.forms === undefined
        ? undefined
        : normalizeJsonArray(body.forms, "forms"),
    media:
      body.media === undefined
        ? undefined
        : normalizeJsonArray(body.media, "media"),
  };
}

function copyTextField(
  target: JsonRecord,
  source: JsonRecord,
  key: string,
  options: { required?: boolean; nullable?: boolean } = {},
): void {
  if (source[key] === undefined) return;

  if (source[key] === null && options.nullable) {
    target[key] = null;
    return;
  }

  if (source[key] === "" && options.nullable) {
    target[key] = null;
    return;
  }

  target[key] = options.required
    ? normalizeRequiredText(source[key], key)
    : normalizeOptionalTextValue(source[key], key);
}

function copyUuidField(
  target: JsonRecord,
  source: JsonRecord,
  key: string,
): void {
  if (source[key] === undefined) return;

  if (source[key] === null || source[key] === "") {
    target[key] = null;
    return;
  }

  target[key] = normalizeRequiredUuid(source[key], key);
}

function copyIntegerField(
  target: JsonRecord,
  source: JsonRecord,
  key: string,
  options: { min?: number; max?: number; nullable?: boolean } = {},
): void {
  if (source[key] === undefined) return;

  if ((source[key] === null || source[key] === "") && options.nullable) {
    target[key] = null;
    return;
  }

  target[key] = normalizeInteger(source[key], key, options);
}

function copyBooleanField(
  target: JsonRecord,
  source: JsonRecord,
  key: string,
): void {
  if (source[key] === undefined) return;
  target[key] = normalizeBoolean(source[key], key);
}

function normalizeOptionalTextValue(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeRequiredText(value, field);
  return normalized;
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

function normalizeJsonArray(value: unknown, field: string): JsonValue {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an array`);
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
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
