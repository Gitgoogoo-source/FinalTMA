import { useSyncExternalStore } from "react";

export type Session = {
  token: string;
  userId: string;
  accountStatus: "normal" | "banned";
  expiresAt: string;
  generation: string;
  recovering?: boolean;
};

let current: Session | null = null;
const listeners = new Set<() => void>();
let cacheClearer = () => {};

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

export function clearSessionCache(): void {
  cacheClearer();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
