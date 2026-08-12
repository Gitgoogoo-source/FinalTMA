import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  validatePublicPetUrl,
  type CatalogImageVariant,
} from "./catalogImageUrl.ts";

const FALLBACK = "/assets/pets/pet-silhouette.svg";
const RETRY_DELAYS = [1_000, 3_000] as const;

type LoadState = {
  attempt: number;
  fallback: boolean;
  ready: boolean;
};

export type CatalogImageStatus = "loading" | "ready" | "failed";

type CatalogImageProps = {
  url: unknown;
  alt: string;
  variant: CatalogImageVariant;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onAvailability?: (available: boolean) => void;
  onStatusChange?: (status: CatalogImageStatus) => void;
};

type CatalogImageSourceProps = {
  validUrl: string | null;
  alt: string;
  variant: CatalogImageVariant;
  loading: "eager" | "lazy" | undefined;
  fetchPriority: "high" | "low" | "auto" | undefined;
  onAvailability: ((available: boolean) => void) | undefined;
  onStatusChange: ((status: CatalogImageStatus) => void) | undefined;
};

export function CatalogImage({
  url,
  alt,
  variant,
  loading,
  fetchPriority,
  onAvailability,
  onStatusChange,
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
      onStatusChange={onStatusChange}
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
  onStatusChange,
}: CatalogImageSourceProps): ReactNode {
  const [state, setState] = useState<LoadState>({
    attempt: 0,
    fallback: !validUrl,
    ready: false,
  });
  const imageRef = useRef<HTMLImageElement>(null);
  const decodingSourceRef = useRef<string | null>(null);
  const failedSourceRef = useRef<string | null>(null);
  const onAvailabilityRef = useRef(onAvailability);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onAvailabilityRef.current = onAvailability;
    onStatusChangeRef.current = onStatusChange;
  }, [onAvailability, onStatusChange]);

  useEffect(() => {
    if (!validUrl || !state.fallback || state.attempt >= RETRY_DELAYS.length)
      return;
    const timer = window.setTimeout(() => {
      setState((previous) => ({
        attempt: previous.attempt + 1,
        fallback: false,
        ready: false,
      }));
    }, RETRY_DELAYS[state.attempt]);
    return () => window.clearTimeout(timer);
  }, [state.attempt, state.fallback, validUrl]);

  const source =
    validUrl && !state.fallback ? retryUrl(validUrl, state.attempt) : FALLBACK;
  const isRemote = source !== FALLBACK;
  const status: CatalogImageStatus = state.ready
    ? "ready"
    : !validUrl || (state.fallback && state.attempt >= RETRY_DELAYS.length)
      ? "failed"
      : "loading";

  useEffect(() => {
    onStatusChangeRef.current?.(status);
    onAvailabilityRef.current?.(status === "ready");
  }, [status]);

  useEffect(() => {
    decodingSourceRef.current = null;
    failedSourceRef.current = null;
  }, [source]);

  const failAttempt = useCallback((attempt: number, loadedSource: string) => {
    const failureKey = `${attempt}:${loadedSource}`;
    if (failedSourceRef.current === failureKey) return;
    failedSourceRef.current = failureKey;
    setState((previous) =>
      previous.attempt === attempt && !previous.ready
        ? { ...previous, fallback: true, ready: false }
        : previous,
    );
  }, []);

  const decodeImage = useCallback(
    (image: HTMLImageElement) => {
      if (!isRemote) return;
      const attempt = state.attempt;
      const loadedSource = image.currentSrc || image.src;
      const decodingKey = `${attempt}:${loadedSource}`;
      if (decodingSourceRef.current === decodingKey) return;
      decodingSourceRef.current = decodingKey;
      void image
        .decode()
        .then(() => {
          if ((image.currentSrc || image.src) !== loadedSource) return;
          setState((previous) =>
            previous.attempt === attempt && !previous.fallback
              ? { ...previous, ready: true }
              : previous,
          );
        })
        .catch(() => {
          if ((image.currentSrc || image.src) !== loadedSource) return;
          failAttempt(attempt, loadedSource);
        });
    },
    [failAttempt, isRemote, state.attempt],
  );

  useEffect(() => {
    const image = imageRef.current;
    if (!isRemote || !image?.complete) return;
    if (image.naturalWidth > 0) decodeImage(image);
    else failAttempt(state.attempt, image.currentSrc || image.src);
  }, [decodeImage, failAttempt, isRemote, source, state.attempt]);

  return (
    <img
      ref={imageRef}
      className={`catalog-image${isRemote ? "" : " catalog-image--fallback"}`}
      src={source}
      alt={alt}
      width={variant === "thumbnail" ? 256 : 768}
      height={variant === "thumbnail" ? 256 : 768}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      onLoad={(event) => decodeImage(event.currentTarget)}
      onError={(event) => {
        if (!isRemote) return;
        failAttempt(
          state.attempt,
          event.currentTarget.currentSrc || event.currentTarget.src,
        );
      }}
    />
  );
}

function retryUrl(value: string, attempt: number): string {
  if (attempt === 0) return value;
  const parsed = new URL(value);
  parsed.searchParams.set("retry", String(attempt));
  return parsed.toString();
}
