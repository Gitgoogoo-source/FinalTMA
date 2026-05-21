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

type UnauthorizedHandler = () => void;

let apiSessionToken: string | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setApiSessionToken(token: string | null): void {
  apiSessionToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function getApiSessionToken(): string | null {
  return apiSessionToken;
}

export function setApiUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): () => void {
  unauthorizedHandler = handler;

  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
}

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

  if (
    options.body !== undefined &&
    options.body !== null &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (apiSessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${apiSessionToken}`);
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
    credentials: "include",
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

    const error = new ApiClientError(errorOptions);
    notifyUnauthorized(path, error);

    throw error;
  }

  if (!response.ok) {
    const error = new ApiClientError({
      code: "API_HTTP_ERROR",
      message: `API request failed with status ${response.status}.`,
      status: response.status,
      details: payload,
    });
    notifyUnauthorized(path, error);

    throw error;
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

function notifyUnauthorized(path: string, error: ApiClientError): void {
  if (error.status !== 401 || isAuthPath(path)) {
    return;
  }

  unauthorizedHandler?.();
}

function isAuthPath(path: string): boolean {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath.startsWith("/auth/");
}
