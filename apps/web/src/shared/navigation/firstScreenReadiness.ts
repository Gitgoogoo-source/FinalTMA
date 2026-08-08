let readyGeneration: string | null = null;
const listeners = new Set<(generation: string) => void>();

export function markFirstScreenReady(generation: string): void {
  if (readyGeneration === generation) return;
  readyGeneration = generation;
  listeners.forEach((listener) => listener(generation));
}

export function isFirstScreenReady(generation: string): boolean {
  return readyGeneration === generation;
}

export function subscribeFirstScreenReady(
  listener: (generation: string) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
