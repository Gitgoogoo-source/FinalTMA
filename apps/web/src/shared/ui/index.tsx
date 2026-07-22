import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";

export { CatalogImage } from "./CatalogImage.tsx";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ className = "", children, ...props }, ref) {
  return (
    <button ref={ref} className={`button ${className}`} {...props}>
      {children}
    </button>
  );
});

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

export function QuantityControl({
  label,
  value,
  min = 1,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange(value: number): void;
}): ReactNode {
  return (
    <div className="inventory-quantity-control">
      <span>{label}</span>
      <div>
        <Button
          aria-label={`减少${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <Button
          aria-label={`增加${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          ＋
        </Button>
      </div>
      <Button
        className="secondary inventory-quantity-all"
        disabled={disabled || value === max}
        onClick={() => onChange(max)}
      >
        全部
      </Button>
    </div>
  );
}
