import type { ReactNode } from "react";

type TelegramProviderProps = {
  children: ReactNode;
};

export function TelegramProvider({ children }: TelegramProviderProps) {
  return <>{children}</>;
}
