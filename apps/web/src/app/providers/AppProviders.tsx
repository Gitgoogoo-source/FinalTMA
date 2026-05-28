import type { ReactNode } from "react";

import { FeedbackProvider } from "./FeedbackProvider";
import { QueryProvider } from "./QueryProvider";
import { SessionProvider } from "./SessionProvider";
import { TelegramProvider } from "./TelegramProvider";
import { TonConnectProvider } from "./TonConnectProvider";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <TelegramProvider>
      <FeedbackProvider>
        <QueryProvider>
          <TonConnectProvider>
            <SessionProvider>{children}</SessionProvider>
          </TonConnectProvider>
        </QueryProvider>
      </FeedbackProvider>
    </TelegramProvider>
  );
}
