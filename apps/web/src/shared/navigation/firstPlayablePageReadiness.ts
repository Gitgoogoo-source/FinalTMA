import type { MainPagePath } from "./pageActivity.tsx";

const readyPages = new Set<string>();
const listeners = new Set<(generation: string, path: MainPagePath) => void>();

function pageKey(generation: string, path: MainPagePath): string {
  return `${generation}:${path}`;
}

export function markFirstPlayablePageReady(
  generation: string,
  path: MainPagePath,
): void {
  const key = pageKey(generation, path);
  if (readyPages.has(key)) return;
  readyPages.add(key);
  listeners.forEach((listener) => listener(generation, path));
}

export function isFirstPlayablePageReady(
  generation: string,
  path: MainPagePath,
): boolean {
  return readyPages.has(pageKey(generation, path));
}

export function subscribeFirstPlayablePageReady(
  listener: (generation: string, path: MainPagePath) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
