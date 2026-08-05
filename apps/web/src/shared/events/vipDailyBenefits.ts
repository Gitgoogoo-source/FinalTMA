type FreeRareClaimedListener = () => void;

const freeRareClaimedListeners = new Set<FreeRareClaimedListener>();

export function notifyFreeRareClaimed(): void {
  for (const listener of freeRareClaimedListeners) listener();
}

export function subscribeFreeRareClaimed(
  listener: FreeRareClaimedListener,
): () => void {
  freeRareClaimedListeners.add(listener);
  return () => freeRareClaimedListeners.delete(listener);
}
