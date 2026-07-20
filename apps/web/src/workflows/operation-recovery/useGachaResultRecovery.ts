import { usePersistentOperationDiscovery } from "./usePersistentOperationDiscovery.ts";

export function useGachaResultRecovery(): void {
  usePersistentOperationDiscovery("gacha.recovery");
}

export function useWheelResultRecovery(): void {
  usePersistentOperationDiscovery("wheel.recovery");
}
