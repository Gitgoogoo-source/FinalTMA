import { useCallback, useEffect, useState, type ReactNode } from "react";

import { StartupScreen } from "../StartupScreen.tsx";
import {
  preloadOperationRegistryProvider,
  type OperationRegistryProviderModule,
} from "../../workflows/operation-recovery/provider-loader.ts";

export function OperationRegistryBoundary({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [loaded, setLoaded] = useState<OperationRegistryProviderModule | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    void preloadOperationRegistryProvider()
      .then((module) => {
        setLoaded(module);
        setFailed(false);
      })
      .catch(() => {
        setLoaded(null);
        setFailed(true);
      });
  }, []);
  useEffect(load, [load]);
  if (loaded) {
    const Provider = loaded.AuthenticatedRuntimeProviders;
    return <Provider>{children}</Provider>;
  }
  return (
    <StartupScreen
      failed={failed}
      title={failed ? "冒险画面暂时无法打开" : "正在准备冒险"}
      message={
        failed ? "当前状态已保留，请重新加载画面。" : "请稍候，伙伴们正在集合"
      }
      retryLabel={failed ? "重新加载画面" : undefined}
      onRetry={failed ? load : undefined}
    />
  );
}
