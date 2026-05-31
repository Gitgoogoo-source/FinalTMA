import { randomUUID } from "node:crypto";

import type { VercelRequest } from "@vercel/node";

import { ApiError } from "../../_shared/handler.js";
import { parseJsonBody } from "../../_shared/parseBody.js";
import { requireAdmin, type AdminContext } from "../../_shared/requireAdmin.js";
import { getSupabaseAdminClient } from "../../../packages/server/src/db/supabaseAdmin.js";
import {
  asJsonRecord,
  normalizeRequiredText,
  requireAdminConfirmation,
  type JsonRecord,
} from "../_shared.js";

export type AdminStorageTargetBucket = "banners" | "boxes" | "collectibles";

export type AdminStorageUploadInput = {
  targetBucket: AdminStorageTargetBucket;
  fileName: string;
  contentType: AdminStorageContentType;
  sizeBytes: number;
};

export type AdminStoragePublishInput = {
  targetBucket: AdminStorageTargetBucket;
  tempPath: string;
  reason: string;
};

export type AdminStoragePreviewInput = {
  targetBucket: AdminStorageTargetBucket;
  tempPath: string;
};

type AdminStorageContentType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

type BucketPolicy = {
  permissions: string[];
  maxBytes: number;
  contentTypes: readonly AdminStorageContentType[];
};

const TEMP_BUCKET = "admin-temp";
const PREVIEW_TTL_SECONDS = 60 * 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_PUBLIC_RE =
  /^(?:(https?):\/\/([^/]+))?\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i;

const BUCKET_POLICIES: Record<AdminStorageTargetBucket, BucketPolicy> = {
  banners: {
    permissions: ["campaigns:write", "catalog:write", "admin:write"],
    maxBytes: 10 * 1024 * 1024,
    contentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  },
  boxes: {
    permissions: ["gacha:write", "admin:write"],
    maxBytes: 30 * 1024 * 1024,
    contentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  },
  collectibles: {
    permissions: ["catalog:write", "admin:write"],
    maxBytes: 20 * 1024 * 1024,
    contentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  },
};

const EXTENSIONS_BY_CONTENT_TYPE: Record<
  AdminStorageContentType,
  readonly string[]
> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

export async function readStorageJsonBody(
  req: VercelRequest,
): Promise<JsonRecord> {
  return asJsonRecord(await parseJsonBody(req, { maxBytes: 32 * 1024 }));
}

export async function requireStorageAdmin(
  req: VercelRequest,
  targetBucket: AdminStorageTargetBucket,
): Promise<AdminContext> {
  return await requireAdmin(req, {
    permissions: BUCKET_POLICIES[targetBucket].permissions,
    requireAll: false,
  });
}

export function normalizeUploadInput(
  body: JsonRecord,
): AdminStorageUploadInput {
  const targetBucket = normalizeTargetBucket(
    body.targetBucket ?? body.target_bucket,
  );
  const contentType = normalizeContentType(
    body.contentType ?? body.content_type,
  );
  const policy = BUCKET_POLICIES[targetBucket];
  const sizeBytes = normalizeSizeBytes(body.sizeBytes ?? body.size_bytes);

  if (!policy.contentTypes.includes(contentType)) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_CONTENT_TYPE_NOT_ALLOWED",
      "File type is not allowed for this target bucket.",
    );
  }

  if (sizeBytes > policy.maxBytes) {
    throw new ApiError(
      413,
      "ADMIN_STORAGE_FILE_TOO_LARGE",
      "File is larger than the target bucket limit.",
      {
        details: {
          maxBytes: policy.maxBytes,
          sizeBytes,
          targetBucket,
        },
      },
    );
  }

  return {
    targetBucket,
    fileName: normalizeRequiredText(
      body.fileName ?? body.file_name,
      "fileName",
    ),
    contentType,
    sizeBytes,
  };
}

export function normalizePublishInput(
  req: VercelRequest,
  body: JsonRecord,
): AdminStoragePublishInput {
  requireAdminConfirmation(req, body);

  const targetBucket = normalizeTargetBucket(
    body.targetBucket ?? body.target_bucket,
  );
  const tempPath = normalizeStorageObjectPath(body.tempPath ?? body.temp_path);
  const reason = normalizeRequiredText(body.reason, "reason");

  assertTempPathMatchesTarget(tempPath, targetBucket);

  return {
    targetBucket,
    tempPath,
    reason,
  };
}

export function normalizePreviewInput(
  body: JsonRecord,
): AdminStoragePreviewInput {
  const targetBucket = normalizeTargetBucket(
    body.targetBucket ?? body.target_bucket,
  );
  const tempPath = normalizeStorageObjectPath(body.tempPath ?? body.temp_path);

  assertTempPathMatchesTarget(tempPath, targetBucket);

  return {
    targetBucket,
    tempPath,
  };
}

export async function createSignedAdminTempUpload(
  input: AdminStorageUploadInput,
) {
  const safeName = createSafeObjectName(input.fileName, input.contentType);
  const today = new Date();
  const tempPath = [
    "pending",
    input.targetBucket,
    String(today.getUTCFullYear()),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    safeName,
  ].join("/");
  const storage = getSupabaseAdminClient().storage.from(TEMP_BUCKET);
  const { data, error } = await storage.createSignedUploadUrl(tempPath, {
    upsert: false,
  });

  if (error || !data?.signedUrl) {
    throw new ApiError(
      500,
      "ADMIN_STORAGE_SIGN_UPLOAD_FAILED",
      "Failed to create signed upload URL.",
      {
        details: { message: error?.message },
        expose: false,
        cause: error,
      },
    );
  }

  return {
    tempBucket: TEMP_BUCKET,
    tempPath,
    targetBucket: input.targetBucket,
    signedUrl: data.signedUrl,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    maxSizeBytes: BUCKET_POLICIES[input.targetBucket].maxBytes,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

export async function createSignedAdminTempPreview(
  input: AdminStoragePreviewInput,
) {
  const preview = await getSupabaseAdminClient()
    .storage.from(TEMP_BUCKET)
    .createSignedUrl(input.tempPath, PREVIEW_TTL_SECONDS, {
      cacheNonce: randomUUID(),
    });

  if (preview.error || !preview.data?.signedUrl) {
    throw new ApiError(
      500,
      "ADMIN_STORAGE_PREVIEW_URL_FAILED",
      "Failed to create upload preview URL.",
      {
        details: { message: preview.error?.message },
        expose: false,
        cause: preview.error,
      },
    );
  }

  return {
    tempBucket: TEMP_BUCKET,
    tempPath: input.tempPath,
    targetBucket: input.targetBucket,
    previewUrl: preview.data.signedUrl,
    previewExpiresAt: new Date(
      Date.now() + PREVIEW_TTL_SECONDS * 1000,
    ).toISOString(),
  };
}

export async function publishAdminTempUpload(input: AdminStoragePublishInput) {
  const publicPath = toPublishedPath(input.tempPath, input.targetBucket);
  const storage = getSupabaseAdminClient().storage;
  const { error } = await storage
    .from(TEMP_BUCKET)
    .move(input.tempPath, publicPath, {
      destinationBucket: input.targetBucket,
    });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_STORAGE_PUBLISH_FAILED",
      "Failed to publish uploaded asset.",
      {
        details: { message: error.message },
        expose: false,
        cause: error,
      },
    );
  }

  const { data } = storage.from(input.targetBucket).getPublicUrl(publicPath);

  if (!isAllowedStoragePublicUrl(data.publicUrl, [input.targetBucket])) {
    throw new ApiError(
      500,
      "ADMIN_STORAGE_PUBLIC_URL_INVALID",
      "Published asset URL is not an allowed Storage URL.",
      {
        details: {
          targetBucket: input.targetBucket,
          publicPath,
        },
        expose: false,
      },
    );
  }

  return {
    bucket: input.targetBucket,
    path: publicPath,
    publicUrl: data.publicUrl,
    publishedAt: new Date().toISOString(),
  };
}

export function assertAllowedStoragePublicUrl(
  value: string,
  field: string,
  allowedBuckets: readonly AdminStorageTargetBucket[],
): void {
  if (!isAllowedStoragePublicUrl(value, allowedBuckets)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a public Supabase Storage URL for: ${allowedBuckets.join(", ")}`,
    );
  }
}

export function isAllowedStoragePublicUrl(
  value: string,
  allowedBuckets: readonly string[],
): boolean {
  const normalized = value.trim();
  const match = normalized.match(STORAGE_PUBLIC_RE);

  if (!match) {
    return false;
  }

  const protocol = match[1]?.toLowerCase();
  const host = match[2]?.toLowerCase();
  const bucket = match[3];
  const objectPath = match[4];

  if (
    !bucket ||
    !allowedBuckets.includes(bucket) ||
    !objectPath ||
    objectPath.includes("..")
  ) {
    return false;
  }

  if (!protocol && !host) {
    return true;
  }

  if (!host) {
    return false;
  }

  const isLocalHost =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:");

  if (isLocalHost) {
    return protocol === "http" || protocol === "https";
  }

  return protocol === "https" && host.endsWith(".supabase.co");
}

function normalizeTargetBucket(value: unknown): AdminStorageTargetBucket {
  const normalized = normalizeRequiredText(value, "targetBucket").toLowerCase();

  if (!Object.hasOwn(BUCKET_POLICIES, normalized)) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_BUCKET_NOT_ALLOWED",
      "Target bucket is not allowed.",
    );
  }

  return normalized as AdminStorageTargetBucket;
}

function normalizeContentType(value: unknown): AdminStorageContentType {
  const normalized = normalizeRequiredText(value, "contentType").toLowerCase();

  if (!Object.hasOwn(EXTENSIONS_BY_CONTENT_TYPE, normalized)) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_CONTENT_TYPE_NOT_ALLOWED",
      "File type is not allowed.",
    );
  }

  return normalized as AdminStorageContentType;
}

function normalizeSizeBytes(value: unknown): number {
  const sizeBytes =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "sizeBytes must be a positive integer.",
    );
  }

  return sizeBytes;
}

function createSafeObjectName(
  fileName: string,
  contentType: AdminStorageContentType,
): string {
  const extension = normalizeExtension(fileName, contentType);
  const basename =
    fileName
      .trim()
      .toLowerCase()
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "asset";

  return `${randomUUID()}-${basename}${extension}`;
}

function normalizeExtension(
  fileName: string,
  contentType: AdminStorageContentType,
): string {
  const lowerName = fileName.trim().toLowerCase();
  const extension = lowerName.match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const allowed = EXTENSIONS_BY_CONTENT_TYPE[contentType];
  const defaultExtension = allowed[0] ?? ".bin";

  if (!extension) {
    return defaultExtension;
  }

  if (!allowed.includes(extension)) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_EXTENSION_NOT_ALLOWED",
      "File extension does not match the file type.",
    );
  }

  return extension === ".jpeg" ? ".jpg" : extension;
}

function normalizeStorageObjectPath(value: unknown): string {
  const path = normalizeRequiredText(value, "tempPath");

  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("..") ||
    path.split("/").some((part) => !part)
  ) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_PATH_INVALID",
      "Storage object path is invalid.",
    );
  }

  return path;
}

function assertTempPathMatchesTarget(
  tempPath: string,
  targetBucket: AdminStorageTargetBucket,
): void {
  if (!tempPath.startsWith(`pending/${targetBucket}/`)) {
    throw new ApiError(
      400,
      "ADMIN_STORAGE_PATH_INVALID",
      "Temporary upload path does not match target bucket.",
    );
  }
}

function toPublishedPath(
  tempPath: string,
  targetBucket: AdminStorageTargetBucket,
): string {
  assertTempPathMatchesTarget(tempPath, targetBucket);
  return tempPath.replace(`pending/${targetBucket}/`, "published/");
}
