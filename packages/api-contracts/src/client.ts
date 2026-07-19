import { z } from "zod";

import {
  successEnvelopeSchema,
  type SuccessEnvelope,
} from "./common/envelope.ts";
import { routeById, type RouteById, type RouteId } from "./registry.ts";

export type RouteInput<Id extends RouteId> = z.input<RouteById<Id>["input"]>;
export type RouteOutput<Id extends RouteId> = z.output<RouteById<Id>["output"]>;
export type RouteResult<Id extends RouteId> =
  RouteById<Id> extends {
    rawResponse: true;
  }
    ? RouteOutput<Id>
    : SuccessEnvelope<RouteOutput<Id>>;

export function parseRouteInput<Id extends RouteId>(
  id: Id,
  input: unknown,
): RouteInput<Id> {
  return routeById(id).input.parse(input) as RouteInput<Id>;
}

export function parseRouteOutput<Id extends RouteId>(
  id: Id,
  value: unknown,
): RouteOutput<Id> {
  return routeById(id).output.parse(value) as RouteOutput<Id>;
}

export function parseRouteResult<Id extends RouteId>(
  id: Id,
  value: unknown,
): RouteResult<Id> {
  const route = routeById(id);
  const parsed =
    "rawResponse" in route && route.rawResponse
      ? route.output.parse(value)
      : successEnvelopeSchema(route.output).parse(value);
  return parsed as unknown as RouteResult<Id>;
}
