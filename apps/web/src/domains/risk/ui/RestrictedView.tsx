import type { ReactNode } from "react";

export function RestrictedView(): ReactNode {
  return <main className="banned" aria-label="账号当前不可使用" />;
}
