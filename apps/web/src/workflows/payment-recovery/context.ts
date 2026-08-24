import type { RouteOutput } from "@evomypet/api-contracts/app-client";
import { createContext, useContext } from "react";

export type NavigationIntent = NonNullable<
  RouteOutput<"topup.order">["intent"]
>;
export type TopupRequest = {
  intent: NavigationIntent;
  estimatedGap: number;
  orderId: string | null;
};
export type GachaResumeAuthorization = {
  orderId: string;
  intent: Extract<NavigationIntent, { kind: "gacha" }>;
};

export type NavigationIntentValue = {
  topupRequest: TopupRequest | null;
  gachaResume: GachaResumeAuthorization | null;
  requestTopup(intent: NavigationIntent, estimatedGap: number): void;
  bindTopupOrder(orderId: string): void;
  activateGachaResume(resume: GachaResumeAuthorization): void;
  clearGachaResume(): void;
  clearTopupRequest(): void;
};

export const NavigationIntentContext =
  createContext<NavigationIntentValue | null>(null);

export function useNavigationIntent(): NavigationIntentValue {
  const value = useContext(NavigationIntentContext);
  if (!value) throw new Error("NavigationIntentProvider is missing");
  return value;
}
