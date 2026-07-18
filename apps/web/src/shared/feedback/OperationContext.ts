import { createContext, useContext } from "react";

export type OperationContextValue = {
  blocked: boolean;
  run<T>(
    label: string,
    action: () => Promise<{ data: T; operationId: string | null }>,
  ): Promise<T | null>;
};

export const OperationContext = createContext<OperationContextValue | null>(
  null,
);

export function useOperation(): OperationContextValue {
  const value = useContext(OperationContext);
  if (!value) throw new Error("OperationProvider is missing");
  return value;
}
