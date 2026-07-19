import type { ReactNode } from "react";

export function AccountGate({
  restricted,
  children = null,
}: {
  restricted: boolean;
  children?: ReactNode;
}): ReactNode {
  return restricted ? null : children;
}
