import { env } from "@/env";

import {
  ApiClientError,
  isApiErrorResponse,
  isApiSuccessResponse,
} from "./errors";

type RequestBody = BodyInit | Record<string, unknown> | null;

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: RequestBody;
  timeoutMs?: number;
};

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

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
  const { body, timeoutMs, signal, ...requestOptions } = options;
  const serializedBody = serializeBody(body);
  const requestAbort = createRequestAbortSignal(
    signal,
    timeoutMs ?? env.REQUEST_TIMEOUT_MS,
  );
  const requestInit: RequestInit = {
    credentials: "include",
    ...requestOptions,
    headers: createHeaders(options),
  };

  if (serializedBody !== undefined) {
    requestInit.body = serializedBody;
  }

  if (requestAbort.signal) {
    requestInit.signal = requestAbort.signal;
  }

  let response: Response;

  try {
    response = await fetch(buildApiUrl(path), requestInit);
  } catch (error) {
    throw createFetchError(error, requestAbort.didTimeout());
  } finally {
    requestAbort.cleanup();
  }

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

function createRequestAbortSignal(
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): {
  signal?: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;

  if (!externalSignal && !effectiveTimeoutMs) {
    return {
      cleanup: () => undefined,
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const abortFromExternalSignal = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }
  }

  if (effectiveTimeoutMs) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, effectiveTimeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternalSignal);
      }
    },
    didTimeout: () => timedOut,
  };
}

function createFetchError(error: unknown, timedOut: boolean): ApiClientError {
  if (timedOut || isAbortError(error)) {
    return new ApiClientError({
      code: "API_REQUEST_TIMEOUT",
      message: "请求超时，请检查网络后重试。",
      status: 0,
      details: error,
    });
  }

  return new ApiClientError({
    code: "API_NETWORK_ERROR",
    message: "网络请求失败，请检查网络后重试。",
    status: 0,
    details: error,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
