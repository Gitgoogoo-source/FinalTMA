// api/shared/parseBody.ts

import type { VercelRequest } from "@vercel/node";
import { badRequest, payloadTooLarge, unsupportedMediaType } from "./errors.js";

export type ParseBodyOptions = {
  maxBytes?: number;
  allowedContentTypes?: string[];
  allowEmpty?: boolean;
};

export type ParsedBody<T = unknown> = {
  body: T;
  rawBody: string;
  contentType: string;
};

const DEFAULT_MAX_BYTES = 1024 * 1024;

function getContentType(req: VercelRequest): string {
  const header = req.headers["content-type"];

  if (!header) {
    return "";
  }

  const value = Array.isArray(header) ? header[0] : header;
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isAllowedContentType(
  contentType: string,
  allowedContentTypes: string[],
): boolean {
  if (allowedContentTypes.length === 0) {
    return true;
  }

  return allowedContentTypes.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase();

    if (normalizedAllowed.endsWith("/*")) {
      const prefix = normalizedAllowed.replace("/*", "/");
      return contentType.startsWith(prefix);
    }

    return contentType === normalizedAllowed;
  });
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function bodyFromAlreadyParsedRequestBody(body: unknown): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (typeof body === "object") {
    return JSON.stringify(body);
  }

  return String(body);
}

export async function readRawBody(
  req: VercelRequest,
  options: Pick<ParseBodyOptions, "maxBytes"> = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const existingBody = bodyFromAlreadyParsedRequestBody(req.body);
  if (existingBody !== null) {
    if (byteLength(existingBody) > maxBytes) {
      throw payloadTooLarge(`Request body exceeds ${maxBytes} bytes`, {
        maxBytes,
      });
    }

    return existingBody;
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        reject(
          payloadTooLarge(`Request body exceeds ${maxBytes} bytes`, {
            maxBytes,
          }),
        );

        req.destroy();
        return;
      }

      chunks.push(buffer);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      reject(
        badRequest("Failed to read request body", {
          message: error.message,
        }),
      );
    });
  });
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw badRequest("Invalid JSON request body");
  }
}

function parseFormUrlEncoded(
  rawBody: string,
): Record<string, string | string[]> {
  const params = new URLSearchParams(rawBody);
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of params.entries()) {
    const existingValue = result[key];

    if (existingValue === undefined) {
      result[key] = value;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      result[key] = [existingValue, value];
    }
  }

  return result;
}

export async function parseBody<T = unknown>(
  req: VercelRequest,
  options: ParseBodyOptions = {},
): Promise<ParsedBody<T>> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowEmpty = options.allowEmpty ?? false;
  const allowedContentTypes = options.allowedContentTypes ?? [
    "application/json",
    "application/x-www-form-urlencoded",
    "text/plain",
  ];

  const contentType = getContentType(req);

  if (contentType && !isAllowedContentType(contentType, allowedContentTypes)) {
    throw unsupportedMediaType(`Unsupported content type: ${contentType}`, {
      contentType,
      allowedContentTypes,
    });
  }

  const rawBody = await readRawBody(req, { maxBytes });

  if (!rawBody || rawBody.trim().length === 0) {
    if (allowEmpty) {
      return {
        body: undefined as T,
        rawBody,
        contentType,
      };
    }

    throw badRequest("Request body is required");
  }

  let body: unknown;

  if (!contentType || contentType === "application/json") {
    body = parseJson(rawBody);
  } else if (contentType === "application/x-www-form-urlencoded") {
    body = parseFormUrlEncoded(rawBody);
  } else if (contentType === "text/plain") {
    body = rawBody;
  } else {
    throw unsupportedMediaType(`Unsupported content type: ${contentType}`, {
      contentType,
      allowedContentTypes,
    });
  }

  return {
    body: body as T,
    rawBody,
    contentType,
  };
}

export async function parseJsonBody<T = unknown>(
  req: VercelRequest,
  options: Omit<ParseBodyOptions, "allowedContentTypes"> = {},
): Promise<T> {
  const parsed = await parseBody<T>(req, {
    ...options,
    allowedContentTypes: ["application/json"],
  });

  return parsed.body;
}

export async function parseOptionalJsonBody<T = unknown>(
  req: VercelRequest,
  options: Omit<ParseBodyOptions, "allowedContentTypes" | "allowEmpty"> = {},
): Promise<T | undefined> {
  const parsed = await parseBody<T | undefined>(req, {
    ...options,
    allowEmpty: true,
    allowedContentTypes: ["application/json"],
  });

  return parsed.body;
}
