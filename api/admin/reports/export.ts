import { parseJsonBody } from "../../_shared/parseBody.js";
import { withApiHandler } from "../../_shared/handler.js";
import { asJsonRecord } from "../_shared.js";
import { exportReportsCsv } from "./_shared.js";

export default withApiHandler(
  async (req, res, ctx) => {
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    await exportReportsCsv({
      req,
      res,
      ctx,
      body,
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
