import { usePersistentOperationDiscovery } from "./usePersistentOperationDiscovery.ts";

export function useEvolutionResultRecovery(): void {
  usePersistentOperationDiscovery("inventory.evolution_recovery");
}
