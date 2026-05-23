import { validationError, type ErrorFieldIssue } from "./errors.js";

export type ValidationSuccess<T> = {
  success: true;
  data: T;
};

export type ValidationFailure = {
  success: false;
  error: {
    issues?: unknown;
    flatten?: () => unknown;
    message?: string;
  };
};

export type SafeParseSchema<T> = {
  safeParse(input: unknown): ValidationSuccess<T> | ValidationFailure;
};

export type ParseSchema<T> = {
  parse(input: unknown): T;
};

export type SchemaLike<T> = SafeParseSchema<T> | ParseSchema<T>;

export function validate<T>(schema: SchemaLike<T>, input: unknown): T {
  if (hasSafeParse(schema)) {
    const result = schema.safeParse(input);

    if (result.success === true) {
      return result.data;
    }

    const failure = result as ValidationFailure;
    throw validationError(
      "请求参数校验失败。",
      normalizeValidationIssues(failure.error),
    );
  }

  try {
    return schema.parse(input);
  } catch (error) {
    throw validationError(
      "请求参数校验失败。",
      normalizeValidationIssues(error),
    );
  }
}

function hasSafeParse<T>(schema: SchemaLike<T>): schema is SafeParseSchema<T> {
  return "safeParse" in schema && typeof schema.safeParse === "function";
}

function normalizeValidationIssues(error: unknown): ErrorFieldIssue[] {
  const issues = getIssues(error);

  if (!Array.isArray(issues)) {
    return [
      {
        path: "",
        message: getErrorMessage(error),
      },
    ];
  }

  return issues.map((issue) => {
    const record = isRecord(issue) ? issue : {};
    const path = normalizePath(record.path);

    return {
      path,
      message:
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message
          : "Invalid value.",
      ...(typeof record.code === "string" ? { code: record.code } : {}),
    };
  });
}

function getIssues(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }

  if ("issues" in error) {
    return error.issues;
  }

  const nestedError = error.error;

  if (isRecord(nestedError) && "issues" in nestedError) {
    return nestedError.issues;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  if (
    isRecord(error) &&
    isRecord(error.error) &&
    typeof error.error.message === "string"
  ) {
    return error.error.message;
  }

  return "Invalid request.";
}

function normalizePath(path: unknown): string {
  if (Array.isArray(path)) {
    return path.map(String).join(".");
  }

  if (typeof path === "string") {
    return path;
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
