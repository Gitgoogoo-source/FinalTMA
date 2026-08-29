const BUTTON_CLICK_VOLUME = 0.35;
const MAX_ACTIVE_SOURCES = 8;
const BUTTON_TARGET_SELECTOR = [
  "button",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="tab"]',
].join(",");
const BUTTON_CLICK_SOUND_URL = new URL(
  "./button-click-music.runtime.wav",
  import.meta.url,
).href;

type PointerActivation = {
  control: Element;
  pointerId: number;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let decodedBuffer: AudioBuffer | null = null;
let decodedBufferPromise: Promise<AudioBuffer | null> | null = null;
const activeSources = new Set<AudioBufferSourceNode>();

const dispose = installButtonClickAudio();
if (import.meta.hot) import.meta.hot.dispose(dispose);

function installButtonClickAudio(): () => void {
  let pointerActivation: PointerActivation | null = null;
  let pointerReleaseTimer: number | null = null;

  const clearPointerReleaseTimer = () => {
    if (pointerReleaseTimer === null) return;
    window.clearTimeout(pointerReleaseTimer);
    pointerReleaseTimer = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || !event.isPrimary || event.button !== 0) return;
    const control = findAvailableControl(event.target);
    if (!control) return;

    clearPointerReleaseTimer();
    pointerActivation = { control, pointerId: event.pointerId };
    playButtonClick();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (pointerActivation?.pointerId !== event.pointerId) return;
    clearPointerReleaseTimer();
    pointerReleaseTimer = window.setTimeout(() => {
      pointerActivation = null;
      pointerReleaseTimer = null;
    }, 0);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (pointerActivation?.pointerId !== event.pointerId) return;
    clearPointerReleaseTimer();
    pointerActivation = null;
  };

  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    const control = findAvailableControl(event.target);
    if (!control) return;

    if (pointerActivation?.control === control) {
      clearPointerReleaseTimer();
      pointerActivation = null;
      return;
    }

    playButtonClick();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("click", onClick, true);
  void prepareButtonClickAudio();

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("click", onClick, true);
    clearPointerReleaseTimer();
    pointerActivation = null;
    disposeAudioRuntime();
  };
}

function findAvailableControl(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(BUTTON_TARGET_SELECTOR);
  if (!control || isUnavailable(control)) return null;
  return control;
}

function playButtonClick(): void {
  const context = getAudioContext();
  const buffer = decodedBuffer;
  if (!context || !buffer) {
    void prepareButtonClickAudio();
    return;
  }

  if (context.state !== "running" && context.state !== "closed") {
    void context.resume().catch(() => undefined);
  }

  const gain = getMasterGain(context);
  if (!gain) return;

  if (activeSources.size >= MAX_ACTIVE_SOURCES) {
    const oldestSource = activeSources.values().next().value;
    if (oldestSource) stopSource(oldestSource);
  }

  try {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.addEventListener(
      "ended",
      () => {
        activeSources.delete(source);
        source.disconnect();
      },
      { once: true },
    );
    activeSources.add(source);
    source.start();
  } catch {
    // Presentation-only audio must never block the control action.
  }
}

function prepareButtonClickAudio(): Promise<AudioBuffer | null> {
  if (decodedBuffer) return Promise.resolve(decodedBuffer);
  if (decodedBufferPromise) return decodedBufferPromise;

  const context = getAudioContext();
  if (!context) return Promise.resolve(null);

  decodedBufferPromise = fetch(BUTTON_CLICK_SOUND_URL, {
    credentials: "same-origin",
  })
    .then((response) => {
      if (!response.ok) throw new Error("BUTTON_CLICK_AUDIO_FETCH_FAILED");
      return response.arrayBuffer();
    })
    .then((audioData) => context.decodeAudioData(audioData))
    .then((buffer) => {
      decodedBuffer = buffer;
      return buffer;
    })
    .catch(() => {
      decodedBufferPromise = null;
      return null;
    });

  return decodedBufferPromise;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (audioContext?.state === "closed") {
    audioContext = null;
    masterGain = null;
    decodedBuffer = null;
    decodedBufferPromise = null;
  }
  if (audioContext) return audioContext;

  try {
    audioContext = new window.AudioContext({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  return audioContext;
}

function getMasterGain(context: AudioContext): GainNode | null {
  if (masterGain) return masterGain;
  try {
    masterGain = context.createGain();
    masterGain.gain.value = BUTTON_CLICK_VOLUME;
    masterGain.connect(context.destination);
  } catch {
    return null;
  }
  return masterGain;
}

function stopSource(source: AudioBufferSourceNode): void {
  activeSources.delete(source);
  try {
    source.stop();
  } catch {
    // The source may already have ended.
  }
  source.disconnect();
}

function disposeAudioRuntime(): void {
  for (const source of activeSources) stopSource(source);
  activeSources.clear();
  masterGain?.disconnect();
  masterGain = null;
  decodedBuffer = null;
  decodedBufferPromise = null;
  const context = audioContext;
  audioContext = null;
  if (context && context.state !== "closed") {
    void context.close().catch(() => undefined);
  }
}

function isUnavailable(control: Element): boolean {
  return (
    control.matches(":disabled") ||
    control.getAttribute("aria-disabled") === "true" ||
    control.closest("[inert], [hidden]") !== null
  );
}
