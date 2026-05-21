import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";

import type { VercelRequest, VercelResponse } from "@vercel/node";

type ApiHandler = (
  req: VercelRequest,
  res: VercelResponse,
) => Promise<void> | void;

type InvokeOptions = {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  query?: Record<string, string | string[]>;
  body?: unknown;
};

export type ApiInvokeResult<T = unknown> = {
  statusCode: number;
  headers: Record<string, number | string | string[]>;
  body: T;
};

class MockResponse {
  public headersSent = false;
  public writableEnded = false;
  public statusCode = 200;
  public headers: Record<string, number | string | string[]> = {};
  public body: unknown = undefined;

  setHeader(name: string, value: number | string | readonly string[]): this {
    const normalizedValue: number | string | string[] =
      typeof value === "number" || typeof value === "string"
        ? value
        : [...value];
    this.headers[name.toLowerCase()] = normalizedValue;
    return this;
  }

  getHeader(name: string): number | string | string[] | undefined {
    return this.headers[name.toLowerCase()];
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }

  end(body?: unknown): this {
    this.body = body ?? null;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }
}

export async function invokeApiHandler<T = unknown>(
  handler: ApiHandler,
  options: InvokeOptions = {},
): Promise<ApiInvokeResult<T>> {
  const request = new EventEmitter() as EventEmitter & Partial<VercelRequest>;
  request.method = options.method ?? "GET";
  request.url = options.url ?? "/";
  request.headers = options.headers ?? {};
  request.query = options.query ?? {};
  request.body = options.body;
  request.destroy = (() => {
    request.emit("close");
    return request as unknown as VercelRequest;
  }) as VercelRequest["destroy"];

  const response = new MockResponse();

  await handler(
    request as unknown as VercelRequest,
    response as unknown as VercelResponse,
  );

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body as T,
  };
}

type TelegramInitDataInput = {
  botToken: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    photo_url?: string;
  };
  authDate: number;
  queryId?: string;
  startParam?: string;
};

export function buildTelegramInitData(input: TelegramInitDataInput): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(input.authDate));
  params.set("query_id", input.queryId ?? "test-query-id");
  params.set("user", JSON.stringify(input.user));

  if (input.startParam) {
    params.set("start_param", input.startParam);
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(input.botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);

  return params.toString();
}
