import type { ReactNode } from "react";

export function AccountGate({
  restricted,
  children = null,
}: {
  restricted: boolean;
  children?: ReactNode;
}): ReactNode {
  return restricted ? (
    <main className="banned" aria-label="账号当前不可使用" />
  ) : (
    children
  );
}
