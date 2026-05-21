import { env } from "@/env";

import {
  ApiClientError,
  isApiErrorResponse,
  isApiSuccessResponse,
} from "./errors";

type RequestBody = BodyInit | Record<string, unknown> | null;

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: RequestBody;
};

function buildApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const base = env.API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${base}${normalizedPath}`;
}

function serializeBody(body: RequestBody | undefined): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }

  return JSON.stringify(body);
}

function createHeaders(options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);

  if (options.body !== undefined && options.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiClientError({
      code: "API_INVALID_JSON",
      message: "API returned invalid JSON.",
      status: response.status,
      details: error,
    });
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { body, ...requestOptions } = options;
  const serializedBody = serializeBody(body);
  const requestInit: RequestInit = {
    ...requestOptions,
    headers: createHeaders(options),
  };

  if (serializedBody !== undefined) {
    requestInit.body = serializedBody;
  }

  const response = await fetch(buildApiUrl(path), requestInit);

  const payload = await parseJsonResponse(response);

  if (isApiErrorResponse(payload)) {
    const errorOptions = {
      code: payload.error.code,
      message: payload.error.message,
      status: response.status,
      details: payload.error.details,
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
    };

    throw new ApiClientError(errorOptions);
  }

  if (!response.ok) {
    throw new ApiClientError({
      code: "API_HTTP_ERROR",
      message: `API request failed with status ${response.status}.`,
      status: response.status,
      details: payload,
    });
  }

  if (!isApiSuccessResponse<T>(payload)) {
    throw new ApiClientError({
      code: "API_INVALID_RESPONSE",
      message: "API response does not match the standard shape.",
      status: response.status,
      details: payload,
    });
  }

  return payload.data;
}
