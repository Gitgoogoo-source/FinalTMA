import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  firstQueryValue,
  normalizeDateEnd,
  normalizeDateStart,
} from "../_shared.js";
import {
  getAdminDb,
  getPage,
  nextCursorFor,
  requireUserId,
  rows,
} from "./_shared.js";

const LEDGER_COLUMNS = [
  "id",
  "user_id",
  "currency_code",
  "entry_type",
  "amount",
  "available_before",
  "available_after",
  "locked_before",
  "locked_after",
  "source_type",
  "source_id",
  "source_ref",
  "idempotency_key",
  "note",
  "created_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["users:read", "admin:read"],
      requireAll: false,
    });

    const db = getAdminDb();
    const userId = requireUserId(req.query.userId ?? req.query.user_id);
    const { limit, offset } = getPage(req.query);
    const currency = firstQueryValue(req.query.currency)?.toUpperCase();
    const sourceType = firstQueryValue(
      req.query.sourceType ?? req.query.source_type,
    );
    const from = normalizeDateStart(req.query.from);
    const to = normalizeDateEnd(req.query.to);
    let query = db
      .schema("economy")
      .from("currency_ledger")
      .select(LEDGER_COLUMNS)
      .eq("user_id", userId);

    if (currency) {
      query = query.eq("currency_code", currency);
    }

    if (sourceType) {
      query = query.eq("source_type", sourceType);
    }

    if (from) {
      query = query.gte("created_at", from);
    }

    if (to) {
      query = query.lte("created_at", to);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      throw new ApiError(
        500,
        "ADMIN_USER_LEDGER_LOOKUP_FAILED",
        "用户流水查询失败。",
        {
          expose: false,
          cause: error,
        },
      );
    }

    const page = nextCursorFor(rows(data), limit, offset);

    return {
      items: page.pageRows,
      nextCursor: page.nextCursor,
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
