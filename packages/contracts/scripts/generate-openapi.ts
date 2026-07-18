import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";
import { z } from "zod";

import {
  routes,
  standardErrorSchema,
  standardSuccessSchema,
} from "../src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "openapi/openapi.json");
const paths: Record<string, Record<string, unknown>> = {};

for (const route of routes) {
  const path = route.path.replaceAll(/:([A-Za-z0-9_]+)/g, "{$1}");
  const method = route.method.toLowerCase();
  const operation: Record<string, unknown> = {
    operationId: route.id.replaceAll(".", "_"),
    tags: [route.id.split(".")[0]],
    security:
      route.gateway === "jobs"
        ? [{ cronSecret: [] }]
        : route.gateway === "integrations"
          ? [{ telegramWebhookSecret: [] }]
          : route.auth
            ? [{ bearerAuth: [] }]
            : [],
    responses:
      route.id === "nft.metadata"
        ? metadataResponses()
        : buildResponses(route.compatibility, route.idempotent),
    "x-compatibility": route.compatibility,
    "x-idempotency-required": route.idempotent,
  };

  if (route.method === "POST") {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: z.toJSONSchema(route.input) } },
    };
    if (route.idempotent && route.compatibility !== "c1") {
      operation.parameters = [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ];
    }
  } else operation.parameters = buildParameters(route.path, route.input);

  paths[path] ??= {};
  paths[path][method] = operation;
}

const document = {
  openapi: "3.1.0",
  info: { title: "PokePets API", version: "1.0.0" },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      cronSecret: { type: "http", scheme: "bearer" },
      telegramWebhookSecret: {
        type: "apiKey",
        in: "header",
        name: "X-Telegram-Bot-Api-Secret-Token",
      },
    },
    schemas: {
      StandardSuccess: z.toJSONSchema(standardSuccessSchema),
      StandardError: z.toJSONSchema(standardErrorSchema),
      C1Success: c1SuccessSchema(),
      C1Error: c1ErrorSchema(),
    },
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  await format(JSON.stringify(document), { parser: "json" }),
  "utf8",
);

function buildResponses(
  compatibility: string,
  idempotent: boolean,
): Record<string, unknown> {
  const success = compatibility === "c1" ? "C1Success" : "StandardSuccess";
  const error = compatibility === "c1" ? "C1Error" : "StandardError";
  const content = (name: string) => ({
    "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
  });
  return {
    "200": { description: "Successful response", content: content(success) },
    ...(idempotent
      ? {
          "202": {
            description: "Operation accepted for durable recovery",
            content: content(success),
          },
        }
      : {}),
    "400": { description: "Invalid request", content: content(error) },
    "401": { description: "Authentication required", content: content(error) },
    "403": { description: "Forbidden", content: content(error) },
    "404": {
      description: "Route or resource not found",
      content: content(error),
    },
    "405": { description: "Method not allowed", content: content(error) },
    "409": { description: "Business conflict", content: content(error) },
    "429": { description: "Rate limited", content: content(error) },
    "500": { description: "Internal error", content: content(error) },
  };
}

function metadataResponses(): Record<string, unknown> {
  return {
    "200": {
      description: "Immutable NFT metadata snapshot",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["name", "description", "image", "attributes"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              image: { type: "string", format: "uri" },
              attributes: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    "400": { description: "Invalid NFT identifier" },
    "404": { description: "Metadata snapshot not found" },
    "500": { description: "Internal error" },
  };
}

function buildParameters(path: string, schema: z.ZodType): unknown[] {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const pathNames = new Set(
    [...path.matchAll(/:([A-Za-z0-9_]+)/g)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    ),
  );
  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    in: pathNames.has(name) ? "path" : "query",
    required: pathNames.has(name) || json.required?.includes(name) === true,
    schema: value,
  }));
}

function c1SuccessSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["ok", "success", "data", "meta", "requestId", "request_id"],
    properties: {
      ok: { const: true },
      success: { const: true },
      data: { type: "object" },
      meta: {
        type: "object",
        required: ["requestId", "elapsedMs"],
        properties: {
          requestId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0 },
        },
      },
      requestId: { type: "string", format: "uuid" },
      request_id: { type: "string", format: "uuid" },
    },
  };
}

function c1ErrorSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["ok", "success", "error", "requestId", "request_id"],
    properties: {
      ok: { const: false },
      success: { const: false },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", pattern: "^[A-Z][A-Z0-9_]+$" },
          message: { type: "string" },
          details: {},
        },
      },
      requestId: { type: "string", format: "uuid" },
      request_id: { type: "string", format: "uuid" },
    },
  };
}
