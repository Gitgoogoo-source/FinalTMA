import { afterEach, describe, expect, it, vi } from "vitest";

import {
  absolutizePublicStorageUrl,
  normalizePublicStorageUrl,
} from "../../api/_shared/publicStorageUrl";

describe("public Storage URL normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefixes Supabase public Storage paths with SUPABASE_URL", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("SUPABASE_STORAGE_PUBLIC_URL", "");

    expect(
      normalizePublicStorageUrl(
        "/storage/v1/object/public/collectibles/forest_sproutling_thumb.png",
      ),
    ).toBe(
      "https://project-ref.supabase.co/storage/v1/object/public/collectibles/forest_sproutling_thumb.png",
    );
  });

  it("uses SUPABASE_STORAGE_PUBLIC_URL when it is explicitly configured", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv(
      "SUPABASE_STORAGE_PUBLIC_URL",
      "https://cdn.example.test/storage/v1/object/public",
    );

    expect(
      absolutizePublicStorageUrl(
        "/storage/v1/object/public/collectibles/forest_sproutling_thumb.png",
      ),
    ).toBe(
      "https://cdn.example.test/storage/v1/object/public/collectibles/forest_sproutling_thumb.png",
    );
  });

  it("leaves existing absolute and non-Storage URLs unchanged", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");

    expect(
      normalizePublicStorageUrl(
        "https://images.example.test/collectibles/forest.png",
      ),
    ).toBe("https://images.example.test/collectibles/forest.png");
    expect(normalizePublicStorageUrl("/nft-metadata/items/forest.json")).toBe(
      "/nft-metadata/items/forest.json",
    );
  });
});
