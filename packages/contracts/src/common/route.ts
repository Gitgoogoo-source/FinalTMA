import { z } from "zod";

export type HttpMethod = "GET" | "POST";
export type Gateway = "app" | "integrations" | "jobs";

export type RouteDefinition<
  Id extends string = string,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> = {
  id: Id;
  method: HttpMethod;
  path: string;
  gateway: Gateway;
  auth: boolean;
  idempotent: boolean;
  rawResponse?: boolean;
  input: Input;
  output: Output;
  errors: readonly string[];
};

export function defineRoute<
  const Id extends string,
  Input extends z.ZodType,
  Output extends z.ZodType,
>(route: RouteDefinition<Id, Input, Output>): RouteDefinition<Id, Input, Output> {
  return route;
}
