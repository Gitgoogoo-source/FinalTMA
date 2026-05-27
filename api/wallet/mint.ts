import { assertMintApiEnabled } from "../../packages/server/src/ton/mintGuards.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

export default withApiHandler(
  async (req) => {
    await requireSession(req);
    await assertMintApiEnabled();

    throw new ApiError(501, "MINT_API_NOT_IMPLEMENTED", "Mint API 尚未开放。");
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.mint",
    },
  },
);
