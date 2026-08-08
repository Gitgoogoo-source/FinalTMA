import { createContext, useCallback, useContext } from "react";

export type PreparePageModule = (target: string) => Promise<void>;

export const PageModulePreparationContext =
  createContext<PreparePageModule | null>(null);

export function usePageModulePreparation(): (target: string) => void {
  const prepare = useContext(PageModulePreparationContext);
  return useCallback(
    (target: string) => {
      void prepare?.(target).catch(() => undefined);
    },
    [prepare],
  );
}
