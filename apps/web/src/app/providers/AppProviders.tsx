import type { ReactNode } from "react";

import { FeedbackProvider } from "./FeedbackProvider";
import { QueryProvider } from "./QueryProvider";
import { SessionProvider } from "./SessionProvider";
import { TelegramProvider } from "./TelegramProvider";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <TelegramProvider>
      <FeedbackProvider>
        <QueryProvider>
          <SessionProvider>{children}</SessionProvider>
        </QueryProvider>
      </FeedbackProvider>
    </TelegramProvider>
  );
}
