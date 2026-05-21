import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";

import { createAppQueryClient } from "@/api/queryClient";
import { getApiErrorMessage, isUnauthorizedApiError } from "@/api/errors";

import { useFeedback } from "./FeedbackProvider";

type QueryProviderProps = {
  children: ReactNode;
};

export function QueryProvider({ children }: QueryProviderProps) {
  const { pushToast } = useFeedback();
  const queryClient = useMemo(
    () =>
      createAppQueryClient((error) => {
        if (isUnauthorizedApiError(error)) {
          pushToast({
            type: "error",
            title: "登录已失效",
            message: "正在尝试重新认证。",
          });
          return;
        }

        pushToast({
          type: "error",
          title: "请求失败",
          message: getApiErrorMessage(error),
        });
      }),
    [pushToast],
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
