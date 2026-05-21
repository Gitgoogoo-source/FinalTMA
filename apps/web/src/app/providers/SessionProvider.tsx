import type { ReactNode } from "react";

type SessionProviderProps = {
  children: ReactNode;
};

export function SessionProvider({ children }: SessionProviderProps) {
  return <>{children}</>;
}
