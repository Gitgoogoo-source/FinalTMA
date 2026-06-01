import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportAdminRenderError } from "../observability";

type AdminErrorBoundaryProps = {
  children: ReactNode;
};

type AdminErrorBoundaryState = {
  errorMessage: string | null;
};

export class AdminErrorBoundary extends Component<
  AdminErrorBoundaryProps,
  AdminErrorBoundaryState
> {
  override state: AdminErrorBoundaryState = {
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): AdminErrorBoundaryState {
    return {
      errorMessage:
        error instanceof Error ? error.message : "Admin 页面渲染失败。",
    };
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    reportAdminRenderError(error, {
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  override render() {
    if (this.state.errorMessage) {
      return (
        <main className="admin-gate">
          <section className="admin-gate__panel">
            <div>
              <p>Admin render error</p>
              <h1>后台页面渲染失败</h1>
              <span>
                已捕获渲染错误并记录脱敏上下文，请刷新页面或切换入口重试。
              </span>
            </div>
            <p className="notice notice--error">{this.state.errorMessage}</p>
            <div className="admin-state-actions">
              <button
                className="icon-button"
                onClick={() => {
                  this.setState({ errorMessage: null });
                }}
                type="button"
              >
                重试渲染
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
