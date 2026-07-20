import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

export function CatalogImage({
  path,
  alt,
  variant,
  loading,
  fetchPriority,
  onAvailability,
}: {
  path: unknown;
  alt: string;
  variant: "thumbnail" | "detail";
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onAvailability?: (available: boolean) => void;
}): ReactNode {
  const requestedSource = path ? String(path) : "";
  const [failure, setFailure] = useState<{
    path: string;
    fallback: boolean;
  } | null>(null);
  const currentFailure = failure?.path === requestedSource ? failure : null;
  const fallback = "/assets/dev/placeholder.webp";
  const missing =
    !requestedSource ||
    currentFailure?.fallback === true ||
    (import.meta.env.PROD && Boolean(currentFailure));
  const source =
    !import.meta.env.PROD && currentFailure ? fallback : requestedSource;
  if (missing)
    return (
      <div className="image-missing">
        <ImageOff />
        <span>资源缺失</span>
      </div>
    );
  return (
    <img
      className="catalog-image"
      src={source}
      alt={alt}
      width={variant === "thumbnail" ? 256 : 768}
      height={variant === "thumbnail" ? 256 : 768}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      onLoad={() => onAvailability?.(true)}
      onError={() => {
        if (!import.meta.env.PROD && source !== fallback) {
          setFailure({ path: requestedSource, fallback: false });
          return;
        }
        setFailure({ path: requestedSource, fallback: source === fallback });
        onAvailability?.(false);
      }}
    />
  );
}
