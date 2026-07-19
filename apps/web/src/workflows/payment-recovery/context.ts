import type { RouteOutput } from "@pokepets/api-contracts/app";
import { createContext, useContext } from "react";

export type NavigationIntent = NonNullable<
  RouteOutput<"topup.order">["intent"]
>;
export type TopupRequest = { intent: NavigationIntent; estimatedGap: number };

export type NavigationIntentValue = {
  topupRequest: TopupRequest | null;
  requestTopup(intent: NavigationIntent, estimatedGap: number): void;
  clearTopupRequest(): void;
};

export const NavigationIntentContext =
  createContext<NavigationIntentValue | null>(null);

export function useNavigationIntent(): NavigationIntentValue {
  const value = useContext(NavigationIntentContext);
  if (!value) throw new Error("NavigationIntentProvider is missing");
  return value;
}
