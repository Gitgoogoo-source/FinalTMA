import { createWorkerCronHandler } from "../_shared/workerCron.js";

export default createWorkerCronHandler("reconciliation", (req, body) => ({
  ...body,
  runTypes:
    req.query.runTypes ??
    req.query.run_types ??
    body.runTypes ??
    body.run_types ??
    null,
  limit: req.query.limit ?? body.limit ?? null,
}));
