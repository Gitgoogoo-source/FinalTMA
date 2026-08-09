type BattleRealtimeRuntime = typeof import("./battleRealtimeRuntime.ts");

let runtimePromise: Promise<BattleRealtimeRuntime> | null = null;

export function loadBattleRealtimeRuntime(): Promise<BattleRealtimeRuntime> {
  if (runtimePromise) return runtimePromise;
  const loading = import("./battleRealtimeRuntime.ts").catch(
    (cause: unknown) => {
      if (runtimePromise === loading) runtimePromise = null;
      throw cause;
    },
  );
  runtimePromise = loading;
  return loading;
}

export function prepareBattleRealtimeRuntime(): Promise<void> {
  return loadBattleRealtimeRuntime().then(() => undefined);
}
