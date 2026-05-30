import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  DROP_POOL_ITEM_COLUMNS,
  FORM_SUMMARY_COLUMNS,
  GACHA_READ_PERMISSIONS,
  TEMPLATE_SUMMARY_COLUMNS,
  assertReadSuccess,
  mapDropPoolItemRow,
  normalizeOptionalQueryUuid,
  normalizeRequiredQueryUuid,
  summarizeDropPoolItems,
  type DropPoolItemRow,
  type FormSummaryRow,
  type TemplateSummaryRow,
} from "./_shared.js";
import {
  buildNextCursor,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: GACHA_READ_PERMISSIONS,
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const poolVersionId = normalizeRequiredQueryUuid(
      req.query.poolVersionId ??
        req.query.dropPoolVersionId ??
        req.query.pool_version_id,
      "poolVersionId",
    );
    const templateId = normalizeOptionalQueryUuid(
      req.query.templateId ?? req.query.template_id,
      "templateId",
    );
    const filters: { poolVersionId: string; templateId?: string } = {
      poolVersionId,
    };

    if (templateId) {
      filters.templateId = templateId;
    }

    const rows = await listDropPoolItems(db, filters, offset, limit);
    const pageRows = rows.slice(0, limit);
    const templatesById = await loadTemplatesById(
      db,
      unique(pageRows.map((item) => item.template_id)),
    );
    const formsById = await loadFormsById(
      db,
      unique(
        pageRows
          .map((item) => item.form_id)
          .filter((formId): formId is string => typeof formId === "string"),
      ),
    );

    return {
      items: pageRows.map((item) =>
        mapDropPoolItemRow(item, templatesById, formsById),
      ),
      summary: summarizeDropPoolItems(pageRows),
      nextCursor: buildNextCursor(rows.length, limit, offset),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function listDropPoolItems(
  db: SupabaseAdminClient,
  filters: {
    poolVersionId: string;
    templateId?: string;
  },
  offset: number,
  limit: number,
): Promise<DropPoolItemRow[]> {
  let query = db
    .schema("gacha")
    .from("drop_pool_items")
    .select(DROP_POOL_ITEM_COLUMNS)
    .eq("pool_version_id", filters.poolVersionId);

  if (filters.templateId) {
    query = query.eq("template_id", filters.templateId);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_DROP_POOL_ITEMS_LOOKUP_FAILED",
    "Failed to load drop pool items.",
  );

  return (data ?? []) as unknown as DropPoolItemRow[];
}

async function loadTemplatesById(
  db: SupabaseAdminClient,
  templateIds: string[],
): Promise<Map<string, TemplateSummaryRow>> {
  if (templateIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("catalog")
    .from("collectible_templates")
    .select(TEMPLATE_SUMMARY_COLUMNS)
    .in("id", templateIds);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_TEMPLATE_LOOKUP_FAILED",
    "Failed to load collectible template summaries.",
  );

  return new Map(
    ((data ?? []) as unknown as TemplateSummaryRow[]).map((template) => [
      template.id,
      template,
    ]),
  );
}

async function loadFormsById(
  db: SupabaseAdminClient,
  formIds: string[],
): Promise<Map<string, FormSummaryRow>> {
  if (formIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("catalog")
    .from("collectible_forms")
    .select(FORM_SUMMARY_COLUMNS)
    .in("id", formIds);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_FORM_LOOKUP_FAILED",
    "Failed to load collectible form summaries.",
  );

  return new Map(
    ((data ?? []) as unknown as FormSummaryRow[]).map((form) => [
      form.id,
      form,
    ]),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
