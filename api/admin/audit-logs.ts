import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  parseAdminLimit,
  parseOffsetCursor,
} from "./_shared.js";
import {
  listAuditLogs,
  loadAdminsById,
  normalizeAuditLogItem,
  summarizeAuditLogs,
} from "./audit-logs.shared.js";

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["audit:read", "admin:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const rows = await listAuditLogs(db, req.query, offset, limit);
    const pageRows = rows.slice(0, limit);
    const adminsById = await loadAdminsById(db, pageRows);
    const items = pageRows.map((row) =>
      normalizeAuditLogItem(
        row,
        adminsById.get(row.admin_user_id ?? "") ?? null,
      ),
    );

    return {
      items,
      summary: summarizeAuditLogs(items),
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
