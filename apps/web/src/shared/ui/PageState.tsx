import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button.tsx";
import { t } from "../../platform/i18n/index.ts";

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
        {t("正在加载")}
      </div>
    );
  if (error && !hasContent)
    return (
      <div className="page-state">
        <AlertCircle />
        <p>{error.message}</p>
        <Button onClick={onRetry}>
          <RefreshCw size={16} />
          {t("重新加载")}
        </Button>
      </div>
    );
  const content = empty ? (
    <div className="page-state">{t("暂无可展示数据")}</div>
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
      <span>{t("内容暂未更新")}</span>
      <Button className="secondary" disabled={retrying} onClick={onRetry}>
        <RefreshCw className={retrying ? "spin" : undefined} size={15} />
        {retrying ? t("正在更新") : t("重新加载")}
      </Button>
    </div>
  );
}
