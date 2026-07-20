import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export { CatalogImage } from "./CatalogImage.tsx";

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
  ...props
}: ComponentProps<"section">): ReactNode {
  return (
    <section className={`card ${className}`} {...props}>
      {children}
    </section>
  );
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

export function Badge({ children }: { children: ReactNode }): ReactNode {
  return <span className="badge">{children}</span>;
}
