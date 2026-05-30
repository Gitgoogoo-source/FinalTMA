import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  isRecord,
  normalizeBoolean,
  normalizeOptionalText,
  parseAdminLimit,
  parseOffsetCursor,
  toJsonObject,
  type JsonRecord,
} from "./_shared.js";
import {
  GACHA_READ_PERMISSIONS,
  GACHA_WRITE_PERMISSIONS,
  assertReadSuccess,
  callGachaWriteRpc,
  normalizeOptionalBodyUuid,
  normalizeOptionalQueryUuid,
  normalizeRequiredQueryUuid,
  readGachaWriteBody,
  requireGachaWriteControls,
  sanitizeAdminJson,
  type DropPoolMutationResult,
} from "./gacha/_shared.js";

type BoxPriceRuleRow = {
  id: string;
  box_id: string;
  quantity: number | string;
  discount_bps: number | string;
  price_stars_override: number | string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type BoxPriceRuleInput = {
  id: string | null;
  boxId: string;
  quantity: 1 | 10;
  discountBps: number;
  priceStarsOverride: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  metadata: ReturnType<typeof toJsonObject>;
};

const BOX_PRICE_RULE_COLUMNS = [
  "id",
  "box_id",
  "quantity",
  "discount_bps",
  "price_stars_override",
  "active",
  "starts_at",
  "ends_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const BOX_PRICE_RULE_QUANTITIES = [1, 10] as const;

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: GACHA_READ_PERMISSIONS,
        requireAll: false,
      });

      return await listBoxPriceRules(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: GACHA_WRITE_PERMISSIONS,
      requireAll: false,
    });
    const body = await readGachaWriteBody(req);
    const controls = requireGachaWriteControls(req, body, admin, ctx);
    const rule = normalizeBoxPriceRuleInput(body, {
      requireId: ctx.method === "PATCH",
    });

    return await callGachaWriteRpc<DropPoolMutationResult>({
      functionName: "admin_upsert_box_price_rule",
      requestId: ctx.requestId,
      args: {
        p_admin_user_id: admin.adminId,
        p_price_rule_id: rule.id,
        p_box_id: rule.boxId,
        p_quantity: rule.quantity,
        p_discount_bps: rule.discountBps,
        p_price_stars_override: rule.priceStarsOverride,
        p_active: rule.active,
        p_starts_at: rule.startsAt,
        p_ends_at: rule.endsAt,
        p_metadata: rule.metadata,
        p_reason: controls.reason,
        p_idempotency_key: controls.idempotencyKey,
        p_request_context: controls.requestContext,
      },
      fallbackCode: "ADMIN_BOX_PRICE_RULE_UPSERT_FAILED",
    });
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function listBoxPriceRules(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const id = normalizeOptionalQueryUuid(queryInput.id, "id");
  const boxId = normalizeOptionalQueryUuid(
    queryInput.boxId ?? queryInput.box_id,
    "boxId",
  );
  const quantity = normalizeOptionalQuantity(
    queryInput.quantity ?? queryInput.draw_count ?? queryInput.drawCount,
  );
  const active = normalizeOptionalBoolean(queryInput.active, "active");

  let query = db
    .schema("gacha")
    .from("box_price_rules")
    .select(BOX_PRICE_RULE_COLUMNS);

  if (id) {
    query = query.eq("id", id);
  }

  if (boxId) {
    query = query.eq("box_id", boxId);
  }

  if (quantity) {
    query = query.eq("quantity", quantity);
  }

  if (active !== undefined) {
    query = query.eq("active", active);
  }

  const { data, error } = await query
    .order("box_id", { ascending: true })
    .order("quantity", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_BOX_PRICE_RULES_LOOKUP_FAILED",
    "Failed to load box price rules.",
  );

  const rows = ((data ?? []) as unknown as BoxPriceRuleRow[]).map(
    mapBoxPriceRuleRow,
  );
  const pageRows = rows.slice(0, limit);

  return {
    items: pageRows,
    summary: summarizePriceRules(pageRows),
    nextCursor: buildNextCursor(rows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

function normalizeBoxPriceRuleInput(
  body: JsonRecord,
  options: { requireId: boolean },
): BoxPriceRuleInput {
  const id = normalizeOptionalBodyUuid(body.id, "id");

  if (options.requireId && !id) {
    throw new ApiError(400, "VALIDATION_FAILED", "id is required");
  }

  const startsAt = normalizeNullableIsoDateTime(body.starts_at, "starts_at");
  const endsAt = normalizeNullableIsoDateTime(body.ends_at, "ends_at");

  assertValidTimeWindow(startsAt, endsAt);

  return {
    id: id ?? null,
    boxId: normalizeRequiredQueryUuid(
      body.box_id ?? body.boxId,
      "box_id",
    ),
    quantity: normalizeQuantity(
      body.quantity ?? body.draw_count ?? body.drawCount,
      "quantity",
    ),
    discountBps: normalizeInteger(body.discount_bps, "discount_bps", {
      min: 0,
      max: 10000,
    }),
    priceStarsOverride: normalizeNullableInteger(
      body.price_stars_override ?? body.price_xtr ?? body.priceXtr,
      "price_stars_override",
      { min: 1 },
    ),
    active: normalizeBoolean(body.active, "active"),
    startsAt,
    endsAt,
    metadata: normalizeJsonObject(body.metadata),
  };
}

function mapBoxPriceRuleRow(row: BoxPriceRuleRow) {
  return {
    ...row,
    quantity: Number(row.quantity),
    discount_bps: Number(row.discount_bps),
    price_stars_override:
      row.price_stars_override === null
        ? null
        : Number(row.price_stars_override),
    metadata: sanitizeAdminJson(row.metadata),
  };
}

function summarizePriceRules(rows: ReturnType<typeof mapBoxPriceRuleRow>[]) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = row.active ? "active" : "inactive";
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function normalizeOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  return normalizeBoolean(raw, field);
}

function normalizeOptionalQuantity(value: unknown): 1 | 10 | undefined {
  const raw = firstQueryValue(value);
  return raw ? normalizeQuantity(raw, "quantity") : undefined;
}

function normalizeQuantity(value: unknown, field: string): 1 | 10 {
  const quantity = normalizeInteger(value, field);

  if (!BOX_PRICE_RULE_QUANTITIES.includes(quantity as 1 | 10)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be one of: ${BOX_PRICE_RULE_QUANTITIES.join(", ")}`,
    );
  }

  return quantity as 1 | 10;
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

function normalizeNullableInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeInteger(value, field, bounds);
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
