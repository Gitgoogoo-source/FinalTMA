import type { VercelRequest } from "@vercel/node";

import {
  ReferralLinkQuerySchema,
} from "../../packages/validation/src/task.schemas.js";
import { getHeaderValue } from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { validate } from "../_shared/validate.js";
import {
  assertNoClientControlledTaskFields,
  compactRecord,
  isRecord,
  withTaskApiHandler,
} from "./_shared.js";
import { buildReferralLinkPayload } from "./referralLink.shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      ReferralLinkQuerySchema,
      normalizeReferralLinkInput(await readOptionalJsonBody(req)),
    );
    const payload = await buildReferralLinkPayload({
      userId: ctx.session.userId,
      scene: input.scene,
      source: input.source,
    });

    return compactRecord({
      ...payload,
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.referral_link",
    },
  },
);

export function normalizeReferralLinkInput(
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  assertNoClientControlledTaskFields(
    body,
    "邀请链接请求不能携带用户身份字段。",
  );

  return {
    campaignId: body.campaignId ?? body.campaign_id,
    scene: body.scene,
    source: body.source,
  };
}

async function readOptionalJsonBody(req: VercelRequest): Promise<unknown> {
  if (!requestHasBody(req)) {
    return {};
  }

  return await parseJsonBody<unknown>(req, {
    maxBytes: 8 * 1024,
  });
}

function requestHasBody(req: VercelRequest): boolean {
  if (req.body !== undefined && req.body !== null) {
    return true;
  }

  const contentLength = getHeaderValue(req.headers["content-length"]);
  return Boolean(contentLength && contentLength !== "0");
}
