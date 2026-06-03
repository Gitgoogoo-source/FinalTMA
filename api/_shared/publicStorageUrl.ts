const OBJECT_PUBLIC_PREFIX = "/storage/v1/object/public/";
const STORAGE_PUBLIC_PATH_PATTERN =
  /^\/?storage\/v1\/(?:object\/public|render\/image\/public)\//i;

export function normalizePublicStorageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return absolutizePublicStorageUrl(trimmed);
}

export function absolutizePublicStorageUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (!STORAGE_PUBLIC_PATH_PATTERN.test(value)) {
    return value;
  }

  const storagePath = value.startsWith("/") ? value : `/${value}`;

  if (storagePath.startsWith(OBJECT_PUBLIC_PREFIX)) {
    const storagePublicBaseUrl = readStoragePublicBaseUrl();

    if (storagePublicBaseUrl) {
      return `${storagePublicBaseUrl}/${storagePath.slice(
        OBJECT_PUBLIC_PREFIX.length,
      )}`;
    }
  }

  const supabaseUrl = readSupabaseUrl();

  return supabaseUrl ? `${supabaseUrl}${storagePath}` : value;
}

function readStoragePublicBaseUrl(): string | null {
  return readEnvUrl("SUPABASE_STORAGE_PUBLIC_URL");
}

function readSupabaseUrl(): string | null {
  return readEnvUrl("SUPABASE_URL");
}

function readEnvUrl(key: string): string | null {
  const value = process.env[key]?.trim();

  if (!value) {
    return null;
  }

  return value.replace(/\/+$/, "");
}
