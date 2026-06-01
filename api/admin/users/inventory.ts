import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { firstQueryValue } from "../_shared.js";
import {
  getAdminDb,
  getPage,
  nextCursorFor,
  requireUserId,
  rows,
} from "./_shared.js";

const INVENTORY_COLUMNS = [
  "id",
  "owner_user_id",
  "template_id",
  "form_id",
  "serial_no",
  "level",
  "exp",
  "power",
  "status",
  "source_type",
  "source_id",
  "nft_mint_status",
  "minted_nft_item_id",
  "lock_version",
  "acquired_at",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["users:read", "inventory:read", "admin:read"],
      requireAll: false,
    });

    const db = getAdminDb();
    const userId = requireUserId(req.query.userId ?? req.query.user_id);
    const { limit, offset } = getPage(req.query);
    const status = firstQueryValue(req.query.status);
    const templateId = firstQueryValue(
      req.query.templateId ?? req.query.template_id,
    );
    let query = db
      .schema("inventory")
      .from("item_instances")
      .select(INVENTORY_COLUMNS)
      .eq("owner_user_id", userId);

    if (status) {
      query = query.eq("status", status);
    }

    if (templateId) {
      query = query.eq("template_id", templateId);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      throw new ApiError(
        500,
        "ADMIN_USER_INVENTORY_LOOKUP_FAILED",
        "用户库存查询失败。",
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
