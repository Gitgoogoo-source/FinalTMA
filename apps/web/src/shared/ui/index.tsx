import { AlertCircle, ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Button({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button className={`button ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <section className={`card ${className}`}>{children}</section>;
}

export function PageState({
  loading,
  error,
  onRetry,
  empty,
  children,
}: {
  loading: boolean;
  error: Error | null;
  onRetry(): void;
  empty?: boolean;
  children: ReactNode;
}): ReactNode {
  if (loading)
    return (
      <div className="page-state">
        <LoaderCircle className="spin" />
        正在加载真实数据
      </div>
    );
  if (error)
    return (
      <div className="page-state">
        <AlertCircle />
        <p>{error.message}</p>
        <Button onClick={onRetry}>
          <RefreshCw size={16} />
          重新加载
        </Button>
      </div>
    );
  if (empty) return <div className="page-state">暂无可展示数据</div>;
  return children;
}

export function CatalogImage({
  path,
  alt,
  onAvailability,
}: {
  path: unknown;
  alt: string;
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
      onLoad={() => onAvailability?.(true)}
      onError={() => {
        if (!import.meta.env.PROD && source !== "/assets/dev/placeholder.webp") {
          setSource("/assets/dev/placeholder.webp");
          return;
        }
        setMissing(true);
        onAvailability?.(false);
      }}
    />
  );
}

export function Badge({ children }: { children: ReactNode }): ReactNode {
  return <span className="badge">{children}</span>;
}
