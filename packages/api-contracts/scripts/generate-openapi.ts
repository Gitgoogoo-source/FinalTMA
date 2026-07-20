import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";
import { z } from "zod";

import {
  errorRegistry,
  routes,
  standardErrorSchema,
  successEnvelopeSchema,
  type ErrorCode,
} from "../src/server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const explicitOutput = process.argv[2];
const output = explicitOutput
  ? resolve(explicitOutput)
  : resolve(root, "openapi/openapi.json");
const paths: Record<string, Record<string, unknown>> = {};

for (const route of routes) {
  const openapiPath = route.path.replaceAll(/:([A-Za-z0-9_]+)/g, "{$1}");
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
    parameters: [
      ...buildParameters(route.path, route.input, route.method),
      ...(route.idempotent
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ]
        : []),
    ],
    responses: buildResponses(
      route.output,
      "rawResponse" in route && route.rawResponse === true,
      route.idempotent && route.id !== "identity.authenticate",
      route.errors,
    ),
    "x-idempotency-required": route.idempotent,
    "x-allow-pending-entry-handoff":
      "allowPendingEntryHandoff" in route &&
      route.allowPendingEntryHandoff === true,
    "x-error-codes": route.errors,
    "x-error-definitions": Object.fromEntries(
      route.errors.map((code) => [code, errorRegistry[code]]),
    ),
    "x-refresh-scopes": "refreshScopes" in route ? route.refreshScopes : [],
  };

  if (route.method === "POST") {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": { schema: bodySchema(route.path, route.input) },
      },
    };
  }

  paths[openapiPath] ??= {};
  paths[openapiPath]![route.method.toLowerCase()] = operation;
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
    schemas: { StandardError: z.toJSONSchema(standardErrorSchema) },
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  await format(JSON.stringify(document), { parser: "json" }),
  "utf8",
);

function buildResponses(
  outputSchema: z.ZodType,
  raw: boolean,
  idempotent: boolean,
  errors: readonly ErrorCode[],
): Record<string, unknown> {
  const success = z.toJSONSchema(
    raw ? outputSchema : successEnvelopeSchema(outputSchema),
  );
  const error = { $ref: "#/components/schemas/StandardError" };
  const content = (schema: unknown) => ({ "application/json": { schema } });
  const errorsByStatus = new Map<string, ErrorCode[]>();
  for (const code of errors) {
    const status = String(errorRegistry[code].status);
    errorsByStatus.set(status, [...(errorsByStatus.get(status) ?? []), code]);
  }
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
    ...Object.fromEntries(
      [...errorsByStatus].map(([status, codes]) => [
        status,
        {
          description: `Errors: ${codes.join(", ")}`,
          content: content(error),
        },
      ]),
    ),
  };
}

function buildParameters(
  path: string,
  schema: z.ZodType,
  method: string,
): unknown[] {
  const json = z.toJSONSchema(schema) as JsonSchema;
  const pathNames = pathParameterNames(path);
  const names =
    method === "GET" ? Object.keys(json.properties ?? {}) : [...pathNames];
  return names.map((name) => ({
    name,
    in: pathNames.has(name) ? "path" : "query",
    required: pathNames.has(name) || json.required?.includes(name) === true,
    schema: json.properties?.[name] ?? { type: "string" },
  }));
}

function bodySchema(path: string, schema: z.ZodType): JsonSchema {
  const json = structuredClone(z.toJSONSchema(schema)) as JsonSchema;
  const pathNames = pathParameterNames(path);
  for (const name of pathNames) delete json.properties?.[name];
  if (json.required)
    json.required = json.required.filter((name) => !pathNames.has(name));
  return json;
}

function pathParameterNames(path: string): Set<string> {
  return new Set(
    [...path.matchAll(/:([A-Za-z0-9_]+)/g)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    ),
  );
}

type JsonSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};
