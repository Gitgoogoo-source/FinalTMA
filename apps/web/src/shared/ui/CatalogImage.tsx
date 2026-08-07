import { useEffect, useState, type ReactNode } from "react";

const FALLBACK = "/assets/pets/pet-silhouette.svg";
const RETRY_DELAYS = [1_000, 3_000] as const;
const PUBLIC_PET_PATH =
  /^\/storage\/v1\/object\/public\/pet-runtime\/catalog\/v[12]\/(thumb|detail)\/pet-[nat]-\d{3}-[123]\.[0-9a-f]{64}\.webp$/;

type LoadState = {
  attempt: number;
  fallback: boolean;
};

type CatalogImageProps = {
  url: unknown;
  alt: string;
  variant: "thumbnail" | "detail";
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onAvailability?: (available: boolean) => void;
};

type CatalogImageSourceProps = {
  validUrl: string | null;
  alt: string;
  variant: "thumbnail" | "detail";
  loading: "eager" | "lazy" | undefined;
  fetchPriority: "high" | "low" | "auto" | undefined;
  onAvailability: ((available: boolean) => void) | undefined;
};

export function CatalogImage({
  url,
  alt,
  variant,
  loading,
  fetchPriority,
  onAvailability,
}: CatalogImageProps): ReactNode {
  const requestedUrl = typeof url === "string" ? url : "";
  return (
    <CatalogImageSource
      key={`${variant}:${requestedUrl}`}
      validUrl={validatePublicPetUrl(requestedUrl, variant)}
      alt={alt}
      variant={variant}
      loading={loading}
      fetchPriority={fetchPriority}
      onAvailability={onAvailability}
    />
  );
}

function CatalogImageSource({
  validUrl,
  alt,
  variant,
  loading,
  fetchPriority,
  onAvailability,
}: CatalogImageSourceProps): ReactNode {
  const [state, setState] = useState<LoadState>({
    attempt: 0,
    fallback: !validUrl,
  });

  useEffect(() => {
    if (!validUrl || !state.fallback || state.attempt >= RETRY_DELAYS.length)
      return;
    const timer = window.setTimeout(() => {
      setState((previous) => ({
        attempt: previous.attempt + 1,
        fallback: false,
      }));
    }, RETRY_DELAYS[state.attempt]);
    return () => window.clearTimeout(timer);
  }, [state.attempt, state.fallback, validUrl]);

  const source =
    validUrl && !state.fallback ? retryUrl(validUrl, state.attempt) : FALLBACK;
  const isRemote = source !== FALLBACK;
  return (
    <img
      className={`catalog-image${isRemote ? "" : " catalog-image--fallback"}`}
      src={source}
      alt={alt}
      width={variant === "thumbnail" ? 256 : 768}
      height={variant === "thumbnail" ? 256 : 768}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      onLoad={() => {
        if (isRemote) onAvailability?.(true);
      }}
      onError={() => {
        if (!isRemote) return;
        setState((previous) => ({ ...previous, fallback: true }));
        onAvailability?.(false);
      }}
    />
  );
}

function validatePublicPetUrl(
  value: string,
  variant: "thumbnail" | "detail",
): string | null {
  try {
    const parsed = new URL(value);
    const match = PUBLIC_PET_PATH.exec(parsed.pathname);
    const expected = variant === "thumbnail" ? "thumb" : "detail";
    return parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      match?.[1] === expected
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function retryUrl(value: string, attempt: number): string {
  if (attempt === 0) return value;
  const parsed = new URL(value);
  parsed.searchParams.set("retry", String(attempt));
  return parsed.toString();
}
