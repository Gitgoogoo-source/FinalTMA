import { withApiHandler } from "../../_shared/handler.js";
import { fetchReportResponse } from "./_shared.js";

export default withApiHandler(
  async (req, _res, ctx) =>
    fetchReportResponse({
      req,
      ctx,
      reportType: "daily",
    }),
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);
