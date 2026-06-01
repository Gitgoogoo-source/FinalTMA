import type { VercelRequest } from "@vercel/node";

import type { JsonObject, JsonValue } from "../../packages/server/src/db/transactions.js";
import type { WorkerJobName } from "../../packages/server/src/jobs/workerRuntime.js";
import { assertCronRequest } from "./cron.js";
import { getIdempotencyKey, withApiHandler } from "./handler.js";
import { parseOptionalJsonBody } from "./parseBody.js";
import { runWorkerByName } from "./workerJobs.js";

type BuildParams = (req: VercelRequest, body: JsonObject) => JsonObject;

export function createWorkerCronHandler(
  jobName: WorkerJobName,
  buildParams: BuildParams = buildDefaultCronParams,
) {
  return withApiHandler(
    async (req, _res, ctx) => {
      assertCronRequest(req);

      const body =
        req.method === "POST"
          ? toJsonObject(await parseOptionalJsonBody(req, { maxBytes: 16 * 1024 }))
          : {};
      const params = buildParams(req, body);

      return runWorkerByName({
        jobName,
        requestId: ctx.requestId,
        triggeredBy: "cron",
        idempotencyKey: getIdempotencyKey(req),
        params,
      });
    },
    {
      methods: ["GET", "POST"],
      rateLimit: {
        action: "cron.job",
      },
    },
  );
}

export function buildDefaultCronParams(
  req: VercelRequest,
  body: JsonObject,
): JsonObject {
  return {
    ...queryToParams(req.query),
    ...body,
  };
}

function queryToParams(query: VercelRequest["query"]): JsonObject {
  const params: JsonObject = {};

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      params[key] = value;
    } else if (Array.isArray(value)) {
      params[key] = value.filter((item): item is string => typeof item === "string");
    }
  }

  return params;
}

function toJsonObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue as JsonObject;
}
