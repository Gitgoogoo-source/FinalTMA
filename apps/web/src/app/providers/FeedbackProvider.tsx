import type { ReactNode } from "react";

type FeedbackProviderProps = {
  children: ReactNode;
};

export function FeedbackProvider({ children }: FeedbackProviderProps) {
  return <>{children}</>;
}
