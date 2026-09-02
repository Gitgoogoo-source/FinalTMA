export type PersistedTutorialStatus = "pending" | "completed" | "dismissed";
export type TutorialStatus = PersistedTutorialStatus | "inactive";

export function resolveTutorialStatus(
  stored: PersistedTutorialStatus | null,
  welcomeRewardGranted: boolean,
): TutorialStatus {
  return stored ?? (welcomeRewardGranted ? "pending" : "inactive");
}

export function hasConsumedSeededEntitlement(
  confirmedFreeOpen: boolean,
  baselineFreeCount: number | null,
  currentFreeCount: number,
): boolean {
  return (
    confirmedFreeOpen ||
    currentFreeCount === 0 ||
    (baselineFreeCount !== null && currentFreeCount < baselineFreeCount)
  );
}
