import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  FORM_SUMMARY_COLUMNS,
  GACHA_READ_PERMISSIONS,
  PITY_RULE_COLUMNS,
  TEMPLATE_SUMMARY_COLUMNS,
  assertReadSuccess,
  mapPityRuleRow,
  normalizeOptionalQueryUuid,
  summarizePityRules,
  type FormSummaryRow,
  type PityRuleRow,
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
    const boxId = normalizeOptionalQueryUuid(
      req.query.boxId ?? req.query.box_id,
      "boxId",
    );
    const poolVersionId = normalizeOptionalQueryUuid(
      req.query.poolVersionId ??
        req.query.dropPoolVersionId ??
        req.query.pool_version_id,
      "poolVersionId",
    );
    const filters: { boxId?: string; poolVersionId?: string } = {};

    if (boxId) {
      filters.boxId = boxId;
    }

    if (poolVersionId) {
      filters.poolVersionId = poolVersionId;
    }

    const rows = await listPityRules(db, filters, offset, limit);
    const pageRows = rows.slice(0, limit);
    const templatesById = await loadTemplatesById(
      db,
      unique(
        pageRows
          .map((rule) => rule.guaranteed_template_id)
          .filter(
            (templateId): templateId is string =>
              typeof templateId === "string",
          ),
      ),
    );
    const formsById = await loadFormsById(
      db,
      unique(
        pageRows
          .map((rule) => rule.guaranteed_form_id)
          .filter((formId): formId is string => typeof formId === "string"),
      ),
    );

    return {
      items: pageRows.map((rule) =>
        mapPityRuleRow(rule, templatesById, formsById),
      ),
      summary: summarizePityRules(pageRows),
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

async function listPityRules(
  db: SupabaseAdminClient,
  filters: {
    boxId?: string;
    poolVersionId?: string;
  },
  offset: number,
  limit: number,
): Promise<PityRuleRow[]> {
  let query = db.schema("gacha").from("pity_rules").select(PITY_RULE_COLUMNS);

  if (filters.boxId) {
    query = query.eq("box_id", filters.boxId);
  }

  if (filters.poolVersionId) {
    query = query.eq("pool_version_id", filters.poolVersionId);
  }

  const { data, error } = await query
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_PITY_RULES_LOOKUP_FAILED",
    "Failed to load pity rules.",
  );

  return (data ?? []) as unknown as PityRuleRow[];
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
