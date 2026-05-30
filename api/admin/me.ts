import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";

export default withApiHandler(
  async (req) => {
    const admin = await requireAdmin(req);

    return {
      adminId: admin.adminId,
      roleCode: admin.roleCode,
      permissions: admin.permissions,
      isSuperAdmin: admin.isSuperAdmin,
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
  },
);
