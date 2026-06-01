import { createWorkerCronHandler } from "../_shared/workerCron.js";

export default createWorkerCronHandler("leaderboard", (req, body) => ({
  ...body,
  weekStart:
    req.query.weekStart ??
    req.query.week_start ??
    body.weekStart ??
    body.week_start ??
    null,
}));
