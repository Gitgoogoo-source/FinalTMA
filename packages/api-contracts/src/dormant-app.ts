import { z } from "zod";

import type {
  DormantRouteById,
  DormantRouteId,
} from "./registries/dormant-app.ts";

export type {
  DormantAppRoute,
  DormantRouteId,
} from "./registries/dormant-app.ts";
import type { DormantAppRoute } from "./registries/dormant-app.ts";

export type DormantRecoverableRoute = Extract<
  DormantAppRoute,
  { idempotent: true }
>;
export type DormantRecoverableRouteId = DormantRecoverableRoute["id"];

export type DormantRouteInput<Id extends DormantRouteId> = z.input<
  DormantRouteById<Id>["input"]
>;
export type DormantRouteOutput<Id extends DormantRouteId> = z.output<
  DormantRouteById<Id>["output"]
>;
