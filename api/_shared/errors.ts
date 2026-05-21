// api/shared/errors.ts

export type ApiErrorCode =
  | 'UNKNOWN_ERROR'
  | 'INTERNAL_SERVER_ERROR'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SESSION_EXPIRED'
  | 'TELEGRAM_INIT_DATA_INVALID'
  | 'WALLET_PROOF_INVALID'
  | 'PAYMENT_INVALID'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'INSUFFICIENT_BALANCE'
  | 'ITEM_LOCKED'
  | 'ITEM_NOT_FOUND'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_NOT_ACTIVE'
  | 'BOX_NOT_AVAILABLE'
  | 'TASK_NOT_COMPLETED'
  | 'TASK_ALREADY_CLAIMED';

export type ErrorFieldIssue = {
  path: string;
  message: string;
  code?: string;
};

export type ErrorDetails = Record<string, unknown> | ErrorFieldIssue[] | null;

export type PublicErrorPayload = {
  code: ApiErrorCode;
  message: string;
  details?: ErrorDetails;
  requestId?: string;
};

export type AppErrorOptions = {
  code: ApiErrorCode;
  message: string;
  statusCode?: number | undefined;
  details?: ErrorDetails | undefined;
  expose?: boolean | undefined;
  cause?: unknown;
};

export class AppError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly details: ErrorDetails | undefined;
  public readonly expose: boolean;
  public readonly cause: unknown | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);

    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? statusCodeFromErrorCode(options.code);
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
    this.cause = options.cause;

    Error.captureStackTrace?.(this, AppError);
  }

  toPublicPayload(requestId?: string): PublicErrorPayload {
    return {
      code: this.expose ? this.code : 'INTERNAL_SERVER_ERROR',
      message: this.expose ? this.message : 'Internal server error',
      ...(this.expose && this.details !== undefined ? { details: this.details } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export function statusCodeFromErrorCode(code: ApiErrorCode): number {
  switch (code) {
    case 'BAD_REQUEST':
    case 'VALIDATION_ERROR':
    case 'TELEGRAM_INIT_DATA_INVALID':
    case 'WALLET_PROOF_INVALID':
    case 'PAYMENT_INVALID':
    case 'BOX_NOT_AVAILABLE':
    case 'TASK_NOT_COMPLETED':
      return 400;

    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
      return 401;

    case 'FORBIDDEN':
      return 403;

    case 'NOT_FOUND':
    case 'ITEM_NOT_FOUND':
    case 'LISTING_NOT_FOUND':
      return 404;

    case 'METHOD_NOT_ALLOWED':
      return 405;

    case 'CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'PAYMENT_ALREADY_PROCESSED':
    case 'ITEM_LOCKED':
    case 'LISTING_NOT_ACTIVE':
    case 'TASK_ALREADY_CLAIMED':
      return 409;

    case 'PAYLOAD_TOO_LARGE':
      return 413;

    case 'UNSUPPORTED_MEDIA_TYPE':
      return 415;

    case 'RATE_LIMITED':
      return 429;

    case 'INSUFFICIENT_BALANCE':
      return 402;

    case 'INTERNAL_SERVER_ERROR':
    case 'UNKNOWN_ERROR':
    default:
      return 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'Internal server error',
      statusCode: 500,
      expose: false,
      cause: error,
    });
  }

  return new AppError({
    code: 'UNKNOWN_ERROR',
    message: 'Unknown error',
    statusCode: 500,
    expose: false,
    cause: error,
  });
}

export function badRequest(message = 'Bad request', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'BAD_REQUEST',
    message,
    statusCode: 400,
    details,
  });
}

export function validationError(message = 'Validation error', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    details,
  });
}

export function unauthorized(message = 'Unauthorized', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'UNAUTHORIZED',
    message,
    statusCode: 401,
    details,
  });
}

export function sessionExpired(message = 'Session expired', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'SESSION_EXPIRED',
    message,
    statusCode: 401,
    details,
  });
}

export function forbidden(message = 'Forbidden', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'FORBIDDEN',
    message,
    statusCode: 403,
    details,
  });
}

export function notFound(message = 'Not found', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'NOT_FOUND',
    message,
    statusCode: 404,
    details,
  });
}

export function methodNotAllowed(message = 'Method not allowed', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'METHOD_NOT_ALLOWED',
    message,
    statusCode: 405,
    details,
  });
}

export function conflict(message = 'Conflict', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'CONFLICT',
    message,
    statusCode: 409,
    details,
  });
}

export function payloadTooLarge(message = 'Payload too large', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'PAYLOAD_TOO_LARGE',
    message,
    statusCode: 413,
    details,
  });
}

export function unsupportedMediaType(
  message = 'Unsupported media type',
  details?: ErrorDetails,
): AppError {
  return new AppError({
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message,
    statusCode: 415,
    details,
  });
}

export function rateLimited(message = 'Too many requests', details?: ErrorDetails): AppError {
  return new AppError({
    code: 'RATE_LIMITED',
    message,
    statusCode: 429,
    details,
  });
}

export function internalServerError(
  message = 'Internal server error',
  details?: ErrorDetails,
): AppError {
  return new AppError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
    statusCode: 500,
    details,
    expose: false,
  });
}

export function businessError(options: {
  code: ApiErrorCode;
  message: string;
  statusCode?: number;
  details?: ErrorDetails;
}): AppError {
  return new AppError({
    code: options.code,
    message: options.message,
    statusCode: options.statusCode,
    details: options.details,
    expose: true,
  });
}
