import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock, requireAdminMock } = vi.hoisted(() => ({
  getSupabaseAdminClientMock: vi.fn(),
  requireAdminMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-storage-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-05-31T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

describe("admin storage asset APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a signed admin-temp upload for banner assets", async () => {
    const storage = createStorageMock();
    getSupabaseAdminClientMock.mockReturnValue(storage.client);

    const { default: handler } =
      await import("../../api/admin/storage/sign-upload");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/storage/sign-upload",
      body: {
        targetBucket: "banners",
        fileName: "Launch Banner.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["campaigns:write", "catalog:write", "admin:write"],
        requireAll: false,
      }),
    );
    expect(storage.fromMock).toHaveBeenCalledWith("admin-temp");
    expect(storage.createSignedUploadUrlMock).toHaveBeenCalledWith(
      expect.stringMatching(/^pending\/banners\/\d{4}\/\d{2}\/.+\.png$/),
      { upsert: false },
    );
    expect(result.body.data).toMatchObject({
      tempBucket: "admin-temp",
      targetBucket: "banners",
      signedUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/upload/sign/admin-temp/path?token=upload-token",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(JSON.stringify(result.body.data)).not.toContain("service_role");
  });

  it("creates a signed preview URL after uploading to admin-temp", async () => {
    const storage = createStorageMock();
    getSupabaseAdminClientMock.mockReturnValue(storage.client);

    const { default: handler } =
      await import("../../api/admin/storage/sign-preview");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/storage/sign-preview",
      body: {
        targetBucket: "banners",
        tempPath: "pending/banners/2026/05/upload.png",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(storage.createSignedUrlMock).toHaveBeenCalledWith(
      "pending/banners/2026/05/upload.png",
      1800,
      expect.objectContaining({ cacheNonce: expect.any(String) }),
    );
    expect(result.body.data).toMatchObject({
      tempBucket: "admin-temp",
      targetBucket: "banners",
      tempPath: "pending/banners/2026/05/upload.png",
      previewUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/sign/admin-temp/path?token=preview-token",
    });
  });

  it("rejects disallowed upload mime types before signing", async () => {
    const storage = createStorageMock();
    getSupabaseAdminClientMock.mockReturnValue(storage.client);

    const { default: handler } =
      await import("../../api/admin/storage/sign-upload");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/storage/sign-upload",
      body: {
        targetBucket: "banners",
        fileName: "payload.svg",
        contentType: "image/svg+xml",
        sizeBytes: 1024,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(storage.createSignedUploadUrlMock).not.toHaveBeenCalled();
  });

  it("moves admin-temp uploads into the target public bucket", async () => {
    const storage = createStorageMock();
    getSupabaseAdminClientMock.mockReturnValue(storage.client);

    const { default: handler } =
      await import("../../api/admin/storage/publish-upload");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/storage/publish-upload",
      headers: {
        "x-admin-confirm": "true",
      },
      body: {
        targetBucket: "banners",
        tempPath: "pending/banners/2026/05/upload.png",
        reason: "publish banner asset",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(storage.moveMock).toHaveBeenCalledWith(
      "pending/banners/2026/05/upload.png",
      "published/2026/05/upload.png",
      { destinationBucket: "banners" },
    );
    expect(storage.getPublicUrlMock).toHaveBeenCalledWith(
      "published/2026/05/upload.png",
    );
    expect(result.body.data).toMatchObject({
      bucket: "banners",
      path: "published/2026/05/upload.png",
      publicUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/public/banners/published/2026/05/upload.png",
    });
  });

  it("rejects publish requests when temp path does not match target bucket", async () => {
    const storage = createStorageMock();
    getSupabaseAdminClientMock.mockReturnValue(storage.client);

    const { default: handler } =
      await import("../../api/admin/storage/publish-upload");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/storage/publish-upload",
      headers: {
        "x-admin-confirm": "true",
      },
      body: {
        targetBucket: "banners",
        tempPath: "pending/boxes/2026/05/upload.png",
        reason: "bad path",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(storage.moveMock).not.toHaveBeenCalled();
  });
});

function createStorageMock() {
  const createSignedUploadUrlMock = vi.fn().mockResolvedValue({
    data: {
      signedUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/upload/sign/admin-temp/path?token=upload-token",
      path: "pending/banners/2026/05/upload.png",
      token: "upload-token",
    },
    error: null,
  });
  const createSignedUrlMock = vi.fn().mockResolvedValue({
    data: {
      signedUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/sign/admin-temp/path?token=preview-token",
    },
    error: null,
  });
  const moveMock = vi.fn().mockResolvedValue({
    data: { message: "Successfully moved" },
    error: null,
  });
  const getPublicUrlMock = vi.fn().mockReturnValue({
    data: {
      publicUrl:
        "https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/public/banners/published/2026/05/upload.png",
    },
  });
  const bucketApi = {
    createSignedUploadUrl: createSignedUploadUrlMock,
    createSignedUrl: createSignedUrlMock,
    move: moveMock,
    getPublicUrl: getPublicUrlMock,
  };
  const fromMock = vi.fn(() => bucketApi);

  return {
    client: {
      storage: {
        from: fromMock,
      },
    },
    fromMock,
    createSignedUploadUrlMock,
    createSignedUrlMock,
    moveMock,
    getPublicUrlMock,
  };
}
