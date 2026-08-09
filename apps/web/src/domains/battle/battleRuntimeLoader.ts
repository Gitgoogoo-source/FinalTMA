import {
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";

type BattleEffectRuntime = typeof import("./battleEffectPlayer.ts");

type NetworkInformationSignal = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

let effectRuntimePromise: Promise<BattleEffectRuntime> | null = null;
let preparedEffectRuntime: BattleEffectRuntime | null = null;

export function loadBattleEffectRuntime(): Promise<BattleEffectRuntime> {
  if (preparedEffectRuntime) return Promise.resolve(preparedEffectRuntime);
  if (effectRuntimePromise) return effectRuntimePromise;
  const loading = import("./battleEffectPlayer.ts")
    .then((runtime) => {
      preparedEffectRuntime = runtime;
      return runtime;
    })
    .catch((cause: unknown) => {
      if (effectRuntimePromise === loading) effectRuntimePromise = null;
      throw cause;
    });
  effectRuntimePromise = loading;
  return loading;
}

export function prepareBattleEffectRuntime(): Promise<void> {
  return loadBattleEffectRuntime().then(() => undefined);
}

export function isBattleEffectRuntimePrepared(): boolean {
  return preparedEffectRuntime !== null;
}

export function startAdaptiveBattleRuntimeWarmup(
  prepare: () => void,
): () => void {
  const idleWindow = window as IdleWindow;
  const connection = (
    navigator as Navigator & { connection?: NetworkInformationSignal }
  ).connection;
  let telegramActive = telegram()?.isActive !== false;
  let disposed = false;
  let prepared = false;
  let idleHandle: number | undefined;
  let timerHandle: number | undefined;

  const cancelScheduled = () => {
    if (idleHandle !== undefined) {
      idleWindow.cancelIdleCallback?.(idleHandle);
      idleHandle = undefined;
    }
    if (timerHandle !== undefined) {
      window.clearTimeout(timerHandle);
      timerHandle = undefined;
    }
  };
  const canWarmUp = () =>
    !disposed &&
    !prepared &&
    document.readyState === "complete" &&
    document.visibilityState === "visible" &&
    navigator.onLine !== false &&
    telegramActive &&
    connection?.saveData === false &&
    connection.effectiveType === "4g";
  const synchronize = () => {
    if (!canWarmUp()) {
      cancelScheduled();
      return;
    }
    if (idleHandle !== undefined || timerHandle !== undefined) return;
    const run = () => {
      idleHandle = undefined;
      timerHandle = undefined;
      if (!canWarmUp()) return;
      prepared = true;
      prepare();
    };
    if (idleWindow.requestIdleCallback)
      idleHandle = idleWindow.requestIdleCallback(run, { timeout: 5_000 });
    else timerHandle = window.setTimeout(run, 1_000);
  };
  const activate = () => {
    telegramActive = true;
    synchronize();
  };
  const deactivate = () => {
    telegramActive = false;
    synchronize();
  };

  window.addEventListener("load", synchronize);
  window.addEventListener("online", synchronize);
  window.addEventListener("offline", synchronize);
  document.addEventListener("visibilitychange", synchronize);
  connection?.addEventListener("change", synchronize);
  const unsubscribeTelegram = subscribeTelegramActivity(activate, deactivate);
  synchronize();

  return () => {
    disposed = true;
    cancelScheduled();
    window.removeEventListener("load", synchronize);
    window.removeEventListener("online", synchronize);
    window.removeEventListener("offline", synchronize);
    document.removeEventListener("visibilitychange", synchronize);
    connection?.removeEventListener("change", synchronize);
    unsubscribeTelegram();
  };
}
