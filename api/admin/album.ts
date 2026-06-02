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
  type JsonRecord,
} from "./_shared.js";
import { assertReadSuccess, sanitizeAdminJson } from "./gacha/_shared.js";

type AlbumBookRow = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  book_type: string;
  series_id: string | null;
  faction_id: string | null;
  rarity_code: string | null;
  cover_url: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type AlbumMilestoneRow = {
  id: string;
  book_id: string;
  required_count: number;
  title: string;
  reward: unknown;
  active: boolean;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type AlbumBookItemRow = {
  book_id: string;
};

type AlbumMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

type AlbumMilestoneInput = {
  milestoneId: string;
  title?: string | undefined;
  requiredCount?: number | undefined;
  reward?: JsonValue | undefined;
  active?: boolean | undefined;
  sortOrder?: number | undefined;
  metadata?: JsonValue | undefined;
};

const ALBUM_READ_PERMISSIONS = [
  "catalog:read",
  "gacha:read",
  "admin:read",
] as const;
const ALBUM_WRITE_PERMISSIONS = ["catalog:write", "admin:write"] as const;
const BOOK_TYPES = ["all", "series", "faction", "rarity", "event"] as const;
const BOOK_COLUMNS = [
  "id",
  "code",
  "display_name",
  "description",
  "book_type",
  "series_id",
  "faction_id",
  "rarity_code",
  "cover_url",
  "active",
  "starts_at",
  "ends_at",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const MILESTONE_COLUMNS = [
  "id",
  "book_id",
  "required_count",
  "title",
  "reward",
  "active",
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
        permissions: [...ALBUM_READ_PERMISSIONS],
        requireAll: false,
      });

      return await listAlbumConfig(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: [...ALBUM_WRITE_PERMISSIONS],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const input = normalizeAlbumMilestoneInput(body);

    try {
      const result = await callAdminWriteRpc<AlbumMutationResult>({
        functionName: "admin_update_album_milestone",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_milestone_id: input.milestoneId,
          p_title: input.title,
          p_required_count: input.requiredCount,
          p_reward: input.reward,
          p_active: input.active,
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
      throw mapAdminRpcError(error, "ADMIN_ALBUM_MILESTONE_UPDATE_FAILED");
    }
  },
  {
    methods: ["GET", "PATCH"],
    rateLimit: false,
  },
);

async function listAlbumConfig(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const bookType = normalizeOptionalEnumQuery(
    queryInput.book_type,
    "book_type",
    BOOK_TYPES,
  );
  const active = normalizeOptionalBooleanQuery(queryInput.active, "active");
  const q = firstQueryValue(queryInput.q);

  let query = db.schema("album").from("books").select(BOOK_COLUMNS);

  if (bookType) {
    query = query.eq("book_type", bookType);
  }

  if (active !== undefined) {
    query = query.eq("active", active);
  }

  if (q) {
    const escaped = escapePostgrestLike(q);
    query = query.or(`code.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_ALBUM_BOOKS_LOOKUP_FAILED",
    "Failed to load album books.",
  );

  const rawRows = (data ?? []) as unknown as AlbumBookRow[];
  const pageRows = rawRows.slice(0, limit);
  const bookIds = pageRows.map((row) => row.id);
  const milestones = await loadMilestones(db, bookIds);
  const itemCounts = await loadBookItemCounts(db, bookIds);
  const items = pageRows.map((row) =>
    mapBookRow(row, milestones.get(row.id) ?? [], itemCounts.get(row.id) ?? 0),
  );

  return {
    items,
    summary: summarizeAlbumBooks(items),
    nextCursor: buildNextCursor(rawRows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

async function loadMilestones(
  db: SupabaseAdminClient,
  bookIds: string[],
): Promise<Map<string, AlbumMilestoneRow[]>> {
  const grouped = new Map<string, AlbumMilestoneRow[]>();

  if (bookIds.length === 0) {
    return grouped;
  }

  const { data, error } = await db
    .schema("album")
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .in("book_id", bookIds)
    .order("sort_order", { ascending: true });

  assertReadSuccess(
    error,
    "ADMIN_ALBUM_MILESTONES_LOOKUP_FAILED",
    "Failed to load album milestones.",
  );

  for (const milestone of (data ?? []) as unknown as AlbumMilestoneRow[]) {
    const list = grouped.get(milestone.book_id) ?? [];
    list.push(milestone);
    grouped.set(milestone.book_id, list);
  }

  return grouped;
}

async function loadBookItemCounts(
  db: SupabaseAdminClient,
  bookIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  if (bookIds.length === 0) {
    return counts;
  }

  const { data, error } = await db
    .schema("album")
    .from("book_items")
    .select("book_id")
    .in("book_id", bookIds);

  assertReadSuccess(
    error,
    "ADMIN_ALBUM_BOOK_ITEMS_LOOKUP_FAILED",
    "Failed to load album book items.",
  );

  for (const row of (data ?? []) as unknown as AlbumBookItemRow[]) {
    counts.set(row.book_id, (counts.get(row.book_id) ?? 0) + 1);
  }

  return counts;
}

function mapBookRow(
  row: AlbumBookRow,
  milestones: AlbumMilestoneRow[],
  itemCount: number,
) {
  return {
    ...row,
    sort_order: Number(row.sort_order),
    metadata: sanitizeAdminJson(row.metadata),
    item_count: itemCount,
    milestones: milestones.map(mapMilestoneRow),
  };
}

function mapMilestoneRow(row: AlbumMilestoneRow) {
  return {
    ...row,
    required_count: Number(row.required_count),
    sort_order: Number(row.sort_order),
    reward: sanitizeAdminJson(row.reward),
    metadata: sanitizeAdminJson(row.metadata),
  };
}

function normalizeAlbumMilestoneInput(body: JsonRecord): AlbumMilestoneInput {
  return {
    milestoneId: normalizeRequiredUuid(
      body.id ?? body.milestone_id,
      "milestone_id",
    ),
    title:
      body.title === undefined
        ? undefined
        : normalizeRequiredText(body.title, "title"),
    requiredCount:
      body.required_count === undefined
        ? undefined
        : normalizeInteger(body.required_count, "required_count", { min: 1 }),
    reward:
      body.reward === undefined
        ? undefined
        : normalizeAlbumRewardArray(body.reward),
    active: normalizeOptionalBoolean(body.active, "active"),
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

function normalizeAlbumRewardArray(value: unknown): JsonValue {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", "reward must be an array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `reward[${index}] must be an object`,
      );
    }

    const rewardType = normalizeOptionalRewardText(
      item.reward_type ?? item.type,
    )?.toUpperCase();
    const currency = normalizeOptionalRewardText(item.currency)?.toUpperCase();

    if (currency || ["KCOIN", "FGEMS", "STAR_DISPLAY"].includes(rewardType ?? "")) {
      const normalizedCurrency =
        currency ?? (rewardType as "KCOIN" | "FGEMS" | "STAR_DISPLAY");
      const amount = normalizeInteger(item.amount, `reward[${index}].amount`, {
        min: 1,
      });

      if (!["KCOIN", "FGEMS", "STAR_DISPLAY"].includes(normalizedCurrency)) {
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          `reward[${index}].currency is unsupported`,
        );
      }

      return {
        currency: normalizedCurrency,
        amount,
      };
    }

    if (!["ITEM", "DECORATION", "COLLECTIBLE"].includes(rewardType ?? "")) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `reward[${index}].reward_type is unsupported`,
      );
    }

    const templateId = normalizeRequiredUuid(
      item.template_id ??
        item.templateId ??
        item.item_template_id ??
        item.itemTemplateId ??
        item.decoration_id ??
        item.decorationId,
      `reward[${index}].template_id`,
    );
    const formId =
      item.form_id === undefined &&
      item.formId === undefined &&
      item.item_form_id === undefined &&
      item.itemFormId === undefined
        ? undefined
        : normalizeNullableUuid(
            item.form_id ?? item.formId ?? item.item_form_id ?? item.itemFormId,
            `reward[${index}].form_id`,
          );
    const quantity =
      item.quantity === undefined
        ? undefined
        : normalizeInteger(item.quantity, `reward[${index}].quantity`, {
            min: 1,
            max: 100,
          });

    return {
      reward_type: rewardType,
      template_id: templateId,
      ...(formId !== undefined ? { form_id: formId } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
    };
  });
}

function normalizeOptionalRewardText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === "") {
    return null;
  }

  return normalizeRequiredUuid(value, field);
}

function normalizeJsonObject(value: unknown, field: string): JsonValue {
  if (!isRecord(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an object`);
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function normalizeOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  return value === undefined ? undefined : normalizeBoolean(value, field);
}

function normalizeOptionalBooleanQuery(
  value: unknown,
  field: string,
): boolean | undefined {
  const raw = firstQueryValue(value);
  return raw === undefined ? undefined : normalizeBoolean(raw, field);
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
  const normalized = normalizeNumber(value, field);

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

function normalizeNumber(value: unknown, field: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(normalized)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a number`);
  }

  return normalized;
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[%_,]/g, (match) => `\\${match}`);
}

function summarizeAlbumBooks(
  rows: Array<{ active: boolean; book_type: string }>,
) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const statusKey = row.active ? "active" : "inactive";
    summary[statusKey] = (summary[statusKey] ?? 0) + 1;
    summary[row.book_type] = (summary[row.book_type] ?? 0) + 1;
    return summary;
  }, {});
}
