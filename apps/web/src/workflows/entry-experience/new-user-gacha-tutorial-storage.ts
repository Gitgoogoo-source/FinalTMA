import type {
  PersistedTutorialStatus,
  TutorialStatus,
} from "./new-user-gacha-tutorial-state.ts";
import { resolveTutorialStatus } from "./new-user-gacha-tutorial-state.ts";

const STORAGE_PREFIX = "evomypet.onboarding.free-normal.v1";

export function initializeTutorialStatus(
  userId: string,
  welcomeRewardGranted: boolean,
): TutorialStatus {
  const stored = readTutorialStatus(userId);
  const status = resolveTutorialStatus(stored, welcomeRewardGranted);
  if (status === "pending" && stored === null)
    writeTutorialStatus(userId, status);
  return status;
}

export function writeTutorialStatus(
  userId: string,
  status: PersistedTutorialStatus,
): void {
  try {
    window.localStorage.setItem(storageKey(userId), status);
  } catch {
    // The current WebView can still run the tutorial without persistence.
  }
}

function readTutorialStatus(userId: string): PersistedTutorialStatus | null {
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return value === "pending" || value === "completed" || value === "dismissed"
      ? value
      : null;
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}
