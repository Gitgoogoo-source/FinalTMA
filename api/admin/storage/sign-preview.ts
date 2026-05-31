import { assertApiRateLimit, withApiHandler } from "../../_shared/handler.js";
import {
  createSignedAdminTempPreview,
  normalizePreviewInput,
  readStorageJsonBody,
  requireStorageAdmin,
} from "./_shared.js";

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: "admin.write",
    });

    const body = await readStorageJsonBody(req);
    const input = normalizePreviewInput(body);

    await requireStorageAdmin(req, input.targetBucket);

    return await createSignedAdminTempPreview(input);
  },
  {
    methods: ["POST"],
    rateLimit: false,
  },
);
