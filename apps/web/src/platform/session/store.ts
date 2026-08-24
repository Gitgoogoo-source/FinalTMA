import { useSyncExternalStore } from "react";
import type { RouteOutput } from "@evomypet/api-contracts/app-client";

import { synchronizeAccountLanguage } from "../i18n/index.ts";

type IdentityInitialState = RouteOutput<"identity.initial">;
type IdentityRecovery = IdentityInitialState["recovery"];

export type EntryHandoffResult =
  | "REFERRAL_BOUND"
  | "REFERRAL_ALREADY_BOUND"
  | "REFERRAL_ALREADY_RECHARGED"
  | "REFERRAL_CANDIDATE_EXPIRED"
  | "REFERRAL_CODE_INVALID"
  | "REFERRAL_INELIGIBLE"
  | "REFERRAL_INVITER_UNAVAILABLE"
  | "REFERRAL_OLD_USER"
  | "REFERRAL_SELF_BIND";

export type Session = {
  token: string;
  userId: string;
  accountStatus: "normal" | "banned";
  expiresAt: string;
  generation: string;
  entryKind: "direct" | "referral" | "battle";
  entryHandoffState: "pending" | "complete";
  entryHandoffCode: string | null;
  entryHandoffResult: EntryHandoffResult | null;
  preferredLanguage: "en" | "zh-CN";
  recovering?: boolean;
  initialStateFailed?: boolean;
};

let current: Session | null = null;
const listeners = new Set<() => void>();
const recoveryListeners = new Set<() => void>();
let cacheClearer = () => {};
let identitySummaryCacheSeeder = (
  _generation: string,
  _data: IdentityInitialState["summary"],
) => {};
let recoverySnapshot: {
  generation: string;
  data: IdentityRecovery;
} | null = null;
const sensitiveStateResetters = new Set<() => void>();

export function getSession(): Session | null {
  return current;
}

export function replaceSession(session: Session | null): void {
  current = session;
  if (recoverySnapshot?.generation !== session?.generation)
    clearIdentityRecovery();
  listeners.forEach((listener) => listener());
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

export function registerSessionCacheClearer(clear: () => void): void {
  cacheClearer = clear;
}

export function registerIdentitySummaryCacheSeeder(
  seed: (generation: string, data: IdentityInitialState["summary"]) => void,
): void {
  identitySummaryCacheSeeder = seed;
}

export function seedSessionInitialState(
  generation: string,
  data: IdentityInitialState,
): void {
  if (
    current?.generation !== generation ||
    current.accountStatus !== "normal" ||
    current.entryHandoffState !== "complete"
  )
    throw new DOMException("Stale session generation", "AbortError");
  identitySummaryCacheSeeder(generation, data.summary);
  synchronizeAccountLanguage(data.summary.user.preferred_language);
  recoverySnapshot = { generation, data: data.recovery };
  recoveryListeners.forEach((listener) => listener());
}

export function getIdentityRecovery(): IdentityRecovery | null {
  const snapshot = recoverySnapshot;
  if (!snapshot || snapshot.generation !== current?.generation) return null;
  return snapshot.data;
}

export function useIdentityRecovery(): IdentityRecovery | null {
  return useSyncExternalStore(
    subscribeIdentityRecovery,
    getIdentityRecovery,
    getIdentityRecovery,
  );
}

export function transitionToBanned(): void {
  const session = current;
  if (session)
    replaceSession({
      ...session,
      accountStatus: "banned",
      generation: crypto.randomUUID(),
      recovering: false,
      initialStateFailed: false,
    });
  else replaceSession(null);
  clearSensitiveState();
}

export function clearSensitiveState(): void {
  cacheClearer();
  clearIdentityRecovery();
  sensitiveStateResetters.forEach((reset) => reset());
}

export function clearSessionCache(): void {
  clearSensitiveState();
}

export function registerSensitiveStateResetter(reset: () => void): () => void {
  sensitiveStateResetters.add(reset);
  return () => {
    sensitiveStateResetters.delete(reset);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribeIdentityRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

function clearIdentityRecovery(): void {
  if (!recoverySnapshot) return;
  recoverySnapshot = null;
  recoveryListeners.forEach((listener) => listener());
}
