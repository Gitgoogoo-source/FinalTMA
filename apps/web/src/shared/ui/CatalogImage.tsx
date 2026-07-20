import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

export function CatalogImage({
  path,
  alt,
  loading,
  onAvailability,
}: {
  path: unknown;
  alt: string;
  loading?: "eager" | "lazy";
  onAvailability?: (available: boolean) => void;
}): ReactNode {
  const [source, setSource] = useState(path ? String(path) : "");
  const [missing, setMissing] = useState(!path);
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
      loading={loading}
      onLoad={() => onAvailability?.(true)}
      onError={() => {
        if (
          !import.meta.env.PROD &&
          source !== "/assets/dev/placeholder.webp"
        ) {
          setSource("/assets/dev/placeholder.webp");
          return;
        }
        setMissing(true);
        onAvailability?.(false);
      }}
    />
  );
}
