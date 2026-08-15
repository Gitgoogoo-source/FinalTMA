type GachaRitualRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

const BUILD_UP_DURATION_SECONDS = 4;
const BUILD_UP_SOURCE_DURATION_SECONDS = 4.02;
const BUILD_UP_AUTOMATION_SAMPLE_COUNT = 2_001;
const BUILD_UP_PREPARATION_CHUNK_SIZE = 256;
const GACHA_BREATH_PERIODS_SECONDS = [
  0.8, 0.58, 0.46, 0.38, 0.33, 0.29, 0.26, 0.23, 0.2, 0.17, 0.13, 0.1, 0.07,
] as const;

type BuildUpAutomation = {
  carrierFrequency: Float32Array;
  carrierGain: Float32Array;
  colorFrequency: Float32Array;
  colorGain: Float32Array;
  filterFrequency: Float32Array;
  subFrequency: Float32Array;
};

type BuildUpAutomationPreparation = {
  automation: BuildUpAutomation;
  cursor: number;
};

let audioContext: AudioContext | null = null;
let preparedBuildUpAutomation: BuildUpAutomation | null = null;
let buildUpAutomationPreparation: BuildUpAutomationPreparation | null = null;

type AudioIdleWindow = Window & {
  requestIdleCallback?(
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout: number },
  ): number;
};

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (audioContext) return audioContext;
  try {
    audioContext = new window.AudioContext({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  return audioContext;
}

/**
 * Must run from the opening click so iOS can unlock Web Audio. Failure is a
 * presentation-only degradation and never blocks the gacha operation.
 */
export function prepareGachaRitualAudio(): void {
  prepareGachaRitualAudioAssets();
  finishBuildUpAutomationPreparation();
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context
      .resume()
      .then(() => primeAudioContext(context))
      .catch(() => undefined);
    return;
  }
  if (context.state === "running") primeAudioContext(context);
}

function primeAudioContext(context: AudioContext): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.012);
}

export function prepareGachaRitualAudioAssets(): void {
  if (
    typeof window === "undefined" ||
    preparedBuildUpAutomation ||
    buildUpAutomationPreparation
  )
    return;
  const preparation: BuildUpAutomationPreparation = {
    automation: {
      carrierFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      carrierGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      colorFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      colorGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      filterFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      subFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
    },
    cursor: 0,
  };
  buildUpAutomationPreparation = preparation;
  const completeOrSchedule = () => {
    if (buildUpAutomationPreparation !== preparation) return;
    fillBuildUpAutomation(preparation, BUILD_UP_PREPARATION_CHUNK_SIZE);
    if (preparation.cursor >= BUILD_UP_AUTOMATION_SAMPLE_COUNT) {
      preparedBuildUpAutomation = preparation.automation;
      buildUpAutomationPreparation = null;
      return;
    }
    schedule(completeOrSchedule);
  };
  schedule(completeOrSchedule);
}

function finishBuildUpAutomationPreparation(): void {
  const preparation = buildUpAutomationPreparation;
  if (!preparation) return;
  fillBuildUpAutomation(preparation, BUILD_UP_AUTOMATION_SAMPLE_COUNT);
  preparedBuildUpAutomation = preparation.automation;
  buildUpAutomationPreparation = null;
}

function fillBuildUpAutomation(
  preparation: BuildUpAutomationPreparation,
  sampleCount: number,
): void {
  const { automation } = preparation;
  const end = Math.min(
    preparation.cursor + sampleCount,
    BUILD_UP_AUTOMATION_SAMPLE_COUNT,
  );
  for (; preparation.cursor < end; preparation.cursor += 1) {
    const cursor = preparation.cursor;
    const seconds =
      (cursor / (BUILD_UP_AUTOMATION_SAMPLE_COUNT - 1)) *
      BUILD_UP_DURATION_SECONDS;
    const { overall, pulse } = breathAt(seconds);
    const growth = Math.pow(overall, 0.76);
    const pulseDepth = mix(1, 0.68, growth);
    const audiblePulse = pulse * pulseDepth;
    const carrierFrequency =
      72 + growth * 46 + audiblePulse * (22 + growth * 8);

    automation.carrierFrequency[cursor] = carrierFrequency;
    automation.carrierGain[cursor] =
      0.014 + growth * 0.022 + audiblePulse * (0.016 + growth * 0.007);
    automation.colorFrequency[cursor] = carrierFrequency * 2.006;
    automation.colorGain[cursor] =
      0.0024 + growth * 0.006 + audiblePulse * (0.005 + growth * 0.004);
    automation.filterFrequency[cursor] =
      280 + growth * 720 + audiblePulse * (420 + growth * 460);
    automation.subFrequency[cursor] = carrierFrequency * 0.5;
  }
}

function schedule(callback: () => void): void {
  const idleWindow = window as AudioIdleWindow;
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(callback, { timeout: 500 });
    return;
  }
  window.setTimeout(callback, 0);
}

export function playGachaRitualBuildUp(): () => void {
  prepareGachaRitualAudioAssets();
  finishBuildUpAutomationPreparation();
  const context = getAudioContext();
  const automation = preparedBuildUpAutomation;
  if (!context || context.state === "closed" || !automation)
    return () => undefined;

  const startedAt = context.currentTime;
  const master = context.createGain();
  const filter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const nodes: AudioScheduledSourceNode[] = [];
  master.gain.setValueAtTime(0.0001, startedAt);
  master.gain.exponentialRampToValueAtTime(0.82, startedAt + 0.035);
  master.gain.setValueAtTime(0.82, startedAt + 3.94);
  master.gain.exponentialRampToValueAtTime(
    0.0001,
    startedAt + BUILD_UP_DURATION_SECONDS,
  );
  filter.type = "lowpass";
  filter.Q.value = 1.25;
  filter.frequency.setValueCurveAtTime(
    automation.filterFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  compressor.threshold.value = -22;
  compressor.knee.value = 16;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.08;
  master.connect(filter).connect(compressor).connect(context.destination);

  const carrier = context.createOscillator();
  const carrierGain = context.createGain();
  carrier.type = "sine";
  carrier.frequency.setValueCurveAtTime(
    automation.carrierFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  carrierGain.gain.setValueCurveAtTime(
    automation.carrierGain,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  carrier.connect(carrierGain).connect(master);
  carrier.start(startedAt);
  carrier.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(carrier);

  const color = context.createOscillator();
  const colorGain = context.createGain();
  color.type = "triangle";
  color.frequency.setValueCurveAtTime(
    automation.colorFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  colorGain.gain.setValueCurveAtTime(
    automation.colorGain,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  color.connect(colorGain).connect(master);
  color.start(startedAt);
  color.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(color);

  const sub = context.createOscillator();
  const subGain = context.createGain();
  sub.type = "sine";
  sub.frequency.setValueCurveAtTime(
    automation.subFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  subGain.gain.setValueAtTime(0.007, startedAt);
  subGain.gain.linearRampToValueAtTime(0.013, startedAt + 3.9);
  sub.connect(subGain).connect(master);
  sub.start(startedAt);
  sub.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(sub);

  return () => {
    nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Scheduled nodes may already have stopped naturally.
      }
      node.disconnect();
    });
    filter.disconnect();
    compressor.disconnect();
    master.disconnect();
  };
}

function breathAt(seconds: number): { overall: number; pulse: number } {
  const elapsed = Math.min(BUILD_UP_DURATION_SECONDS, Math.max(0, seconds));
  let startedAt = 0;
  for (let index = 0; index < GACHA_BREATH_PERIODS_SECONDS.length; index += 1) {
    const period = GACHA_BREATH_PERIODS_SECONDS[index] ?? 0.07;
    const endedAt = startedAt + period;
    if (
      elapsed < endedAt ||
      index === GACHA_BREATH_PERIODS_SECONDS.length - 1
    ) {
      const progress = clamp((elapsed - startedAt) / period);
      return {
        overall: clamp(
          (index + progress) / GACHA_BREATH_PERIODS_SECONDS.length,
        ),
        pulse: Math.sin(progress * Math.PI),
      };
    }
    startedAt = endedAt;
  }
  return { overall: 1, pulse: 0 };
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function playGachaRitualReveal(rarity: GachaRitualRarity): () => void {
  const context = getAudioContext();
  if (!context || context.state === "closed") return () => undefined;

  const rank = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  }[rarity];
  const startedAt = context.currentTime;
  const master = context.createGain();
  const nodes: AudioScheduledSourceNode[] = [];
  master.gain.setValueAtTime(0.0001, startedAt);
  master.gain.exponentialRampToValueAtTime(
    0.12 + rank * 0.012,
    startedAt + 0.025,
  );
  master.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.66);
  master.connect(context.destination);

  const baseFrequency = 260 + rank * 42;
  [1, 1.5, 2].slice(0, rank >= 3 ? 3 : 2).forEach((ratio, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = index === 0 ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(baseFrequency * ratio, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(
      baseFrequency * ratio * 1.38,
      startedAt + 0.58,
    );
    oscillator.connect(master);
    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.68);
    nodes.push(oscillator);
  });

  const noiseLength = Math.max(1, Math.round(context.sampleRate * 0.18));
  const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noise.length; index += 1)
    noise[index] = (Math.random() * 2 - 1) * (1 - index / noise.length);
  const burst = context.createBufferSource();
  const burstFilter = context.createBiquadFilter();
  burst.buffer = noiseBuffer;
  burstFilter.type = "bandpass";
  burstFilter.frequency.value = 900 + rank * 280;
  burstFilter.Q.value = 0.7;
  burst.connect(burstFilter).connect(master);
  burst.start(startedAt);
  nodes.push(burst);

  return () => {
    nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Scheduled nodes may already have stopped naturally.
      }
      node.disconnect();
    });
    master.disconnect();
  };
}
