import { assertApiRateLimit, withApiHandler } from "../../_shared/handler.js";
import {
  normalizePublishInput,
  publishAdminTempUpload,
  readStorageJsonBody,
  requireStorageAdmin,
} from "./_shared.js";

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: "admin.write",
    });

    const body = await readStorageJsonBody(req);
    const input = normalizePublishInput(req, body);

    await requireStorageAdmin(req, input.targetBucket);

    return await publishAdminTempUpload(input);
  },
  {
    methods: ["POST"],
    rateLimit: false,
  },
);
