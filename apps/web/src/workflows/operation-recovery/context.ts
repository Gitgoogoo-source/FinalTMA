import { createContext, useContext } from "react";
import type {
  RecoverableRouteId,
  RecoverableOperationSummary,
  RouteInput,
  RouteOutput,
} from "@pokepets/api-contracts/app";

export type OperationPhase =
  | "confirming"
  | "submitting"
  | "pending"
  | "unknown"
  | "succeeded"
  | "failed";

export type OperationRegistryValue = {
  run<Id extends RecoverableRouteId>(
    label: string,
    routeId: Id,
    input: RouteInput<Id>,
    options?: { background?: boolean; dialog?: boolean },
  ): Promise<RouteOutput<Id> | null>;
  isBlocked(routeId: RecoverableRouteId): boolean;
  navigationLocked: boolean;
  hydrate(operations: readonly RecoverableOperationSummary[]): void;
};

export const OperationRegistryContext =
  createContext<OperationRegistryValue | null>(null);

export function useOperationRegistry(): OperationRegistryValue {
  const value = useContext(OperationRegistryContext);
  if (!value) throw new Error("OperationRegistryProvider is missing");
  return value;
}
