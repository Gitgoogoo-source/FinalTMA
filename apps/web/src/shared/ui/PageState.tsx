import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button.tsx";

export function PageState({
  loading,
  error,
  onRetry,
  hasContent = false,
  retrying = false,
  empty,
  children,
}: {
  loading: boolean;
  error: Error | null;
  onRetry(): void;
  hasContent?: boolean;
  retrying?: boolean;
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
  if (error && !hasContent)
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
  const content = empty ? (
    <div className="page-state">暂无可展示数据</div>
  ) : (
    children
  );
  if (!error) return content;
  return (
    <>
      <StaleContentNotice onRetry={onRetry} retrying={retrying} />
      {content}
    </>
  );
}

export function StaleContentNotice({
  onRetry,
  retrying = false,
}: {
  onRetry(): void;
  retrying?: boolean;
}): ReactNode {
  return (
    <div className="stale-content-notice" role="status" aria-live="polite">
      <span>内容暂未更新</span>
      <Button className="secondary" disabled={retrying} onClick={onRetry}>
        <RefreshCw className={retrying ? "spin" : undefined} size={15} />
        {retrying ? "正在更新" : "重新加载"}
      </Button>
    </div>
  );
}
