import { useSyncExternalStore } from "react";

export type Session = {
  token: string;
  userId: string;
  accountStatus: "normal" | "banned";
  expiresAt: string;
  generation: string;
  recovering?: boolean;
  bootstrapFailed?: boolean;
};

let current: Session | null = null;
const listeners = new Set<() => void>();
let cacheClearer = () => {};
let bootstrapCacheSeeder = (_generation: string, _data: unknown) => {};
const sensitiveStateResetters = new Set<() => void>();

export function getSession(): Session | null {
  return current;
}

export function replaceSession(session: Session | null): void {
  current = session;
  listeners.forEach((listener) => listener());
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

export function registerSessionCacheClearer(clear: () => void): void {
  cacheClearer = clear;
}

export function registerBootstrapCacheSeeder(
  seed: (generation: string, data: unknown) => void,
): void {
  bootstrapCacheSeeder = seed;
}

export function seedSessionBootstrap(generation: string, data: unknown): void {
  bootstrapCacheSeeder(generation, data);
}

export function clearSensitiveState(): void {
  cacheClearer();
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
