type GachaRitualRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

const BUILD_UP_DURATION_SECONDS = 4;
const BUILD_UP_SOURCE_DURATION_SECONDS = 4.02;
const BUILD_UP_AUTOMATION_SAMPLE_COUNT = 2_001;
const BUILD_UP_PREPARATION_CHUNK_SIZE = 256;
const BUILD_UP_TEXTURE_SAMPLE_RATE = 12_000;
const BUILD_UP_TEXTURE_SAMPLE_COUNT = 16_384;
const BUILD_UP_TEXTURE_PREPARATION_CHUNK_SIZE = 2_048;
const GACHA_BREATH_PERIODS_SECONDS = [
  0.8, 0.58, 0.46, 0.38, 0.33, 0.29, 0.26, 0.23, 0.2, 0.17, 0.13, 0.1, 0.07,
] as const;

type BuildUpAutomation = {
  foundationFrequency: Float32Array;
  foundationGain: Float32Array;
  auraFrequency: Float32Array;
  auraGain: Float32Array;
  airFrequency: Float32Array;
  airGain: Float32Array;
  shimmerFrequency: Float32Array;
  shimmerGain: Float32Array;
};

type BuildUpAssets = {
  automation: BuildUpAutomation;
  texture: Float32Array;
};

type BuildUpAssetsPreparation = {
  assets: BuildUpAssets;
  automationCursor: number;
  textureCursor: number;
  textureRandomState: number;
  textureColor: number;
};

let audioContext: AudioContext | null = null;
let preparedBuildUpAssets: BuildUpAssets | null = null;
let preparedBuildUpTextureBuffer: AudioBuffer | null = null;
let buildUpAssetsPreparation: BuildUpAssetsPreparation | null = null;

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
  finishBuildUpAssetsPreparation();
  const context = getAudioContext();
  if (!context) return;
  prepareBuildUpTextureBuffer(context);
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
    preparedBuildUpAssets ||
    buildUpAssetsPreparation
  )
    return;
  const preparation: BuildUpAssetsPreparation = {
    assets: {
      automation: {
        foundationFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        foundationGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        auraFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        auraGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        airFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        airGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        shimmerFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        shimmerGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
      },
      texture: new Float32Array(BUILD_UP_TEXTURE_SAMPLE_COUNT),
    },
    automationCursor: 0,
    textureCursor: 0,
    textureRandomState: 0x6d2b79f5,
    textureColor: 0,
  };
  buildUpAssetsPreparation = preparation;
  const completeOrSchedule = () => {
    if (buildUpAssetsPreparation !== preparation) return;
    fillBuildUpAutomation(preparation, BUILD_UP_PREPARATION_CHUNK_SIZE);
    fillBuildUpTexture(preparation, BUILD_UP_TEXTURE_PREPARATION_CHUNK_SIZE);
    if (
      preparation.automationCursor >= BUILD_UP_AUTOMATION_SAMPLE_COUNT &&
      preparation.textureCursor >= BUILD_UP_TEXTURE_SAMPLE_COUNT
    ) {
      preparedBuildUpAssets = preparation.assets;
      buildUpAssetsPreparation = null;
      return;
    }
    schedule(completeOrSchedule);
  };
  schedule(completeOrSchedule);
}

function finishBuildUpAssetsPreparation(): void {
  const preparation = buildUpAssetsPreparation;
  if (!preparation) return;
  fillBuildUpAutomation(preparation, BUILD_UP_AUTOMATION_SAMPLE_COUNT);
  fillBuildUpTexture(preparation, BUILD_UP_TEXTURE_SAMPLE_COUNT);
  preparedBuildUpAssets = preparation.assets;
  buildUpAssetsPreparation = null;
}

function fillBuildUpAutomation(
  preparation: BuildUpAssetsPreparation,
  sampleCount: number,
): void {
  const { automation } = preparation.assets;
  const end = Math.min(
    preparation.automationCursor + sampleCount,
    BUILD_UP_AUTOMATION_SAMPLE_COUNT,
  );
  for (
    ;
    preparation.automationCursor < end;
    preparation.automationCursor += 1
  ) {
    const cursor = preparation.automationCursor;
    const seconds =
      (cursor / (BUILD_UP_AUTOMATION_SAMPLE_COUNT - 1)) *
      BUILD_UP_DURATION_SECONDS;
    const { overall, pulse } = breathAt(seconds);
    const growth = Math.pow(overall, 0.82);
    const softPulse = Math.pow(pulse, 1.35);
    const audiblePulse = softPulse * mix(0.92, 0.62, growth);
    const foundationFrequency =
      54 + growth * 16 + audiblePulse * (2.8 + growth * 1.2);

    automation.foundationFrequency[cursor] = foundationFrequency;
    automation.foundationGain[cursor] =
      0.011 + growth * 0.009 + audiblePulse * (0.0045 + growth * 0.0015);
    automation.auraFrequency[cursor] = foundationFrequency * 2.5;
    automation.auraGain[cursor] =
      0.002 + growth * 0.0035 + audiblePulse * (0.0025 + growth * 0.001);
    automation.airFrequency[cursor] =
      360 + growth * 920 + audiblePulse * (300 + growth * 420);
    automation.airGain[cursor] =
      0.016 + growth * 0.016 + audiblePulse * (0.021 + growth * 0.006);
    automation.shimmerFrequency[cursor] =
      1_500 + growth * 2_300 + audiblePulse * (420 + growth * 650);
    automation.shimmerGain[cursor] =
      0.003 + growth * 0.007 + audiblePulse * (0.009 + growth * 0.003);
  }
}

function fillBuildUpTexture(
  preparation: BuildUpAssetsPreparation,
  sampleCount: number,
): void {
  const { texture } = preparation.assets;
  const end = Math.min(
    preparation.textureCursor + sampleCount,
    BUILD_UP_TEXTURE_SAMPLE_COUNT,
  );
  for (; preparation.textureCursor < end; preparation.textureCursor += 1) {
    let state = preparation.textureRandomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    preparation.textureRandomState = state >>> 0;
    const white = (preparation.textureRandomState / 0xffffffff) * 2 - 1;
    preparation.textureColor = preparation.textureColor * 0.82 + white * 0.18;
    texture[preparation.textureCursor] =
      white * 0.36 + preparation.textureColor * 0.64;
  }
}

function prepareBuildUpTextureBuffer(
  context: AudioContext,
): AudioBuffer | null {
  if (preparedBuildUpTextureBuffer) return preparedBuildUpTextureBuffer;
  const assets = preparedBuildUpAssets;
  if (!assets) return null;
  try {
    const buffer = context.createBuffer(
      1,
      assets.texture.length,
      BUILD_UP_TEXTURE_SAMPLE_RATE,
    );
    buffer.getChannelData(0).set(assets.texture);
    preparedBuildUpTextureBuffer = buffer;
    return buffer;
  } catch {
    return null;
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
  finishBuildUpAssetsPreparation();
  const context = getAudioContext();
  const assets = preparedBuildUpAssets;
  if (!context || context.state === "closed" || !assets) return () => undefined;
  const textureBuffer = prepareBuildUpTextureBuffer(context);
  const { automation } = assets;

  const startedAt = context.currentTime;
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const nodes: AudioScheduledSourceNode[] = [];
  const processors: AudioNode[] = [];
  master.gain.setValueAtTime(0.0001, startedAt);
  master.gain.exponentialRampToValueAtTime(0.86, startedAt + 0.12);
  master.gain.setValueAtTime(0.86, startedAt + 3.9);
  master.gain.exponentialRampToValueAtTime(
    0.0001,
    startedAt + BUILD_UP_DURATION_SECONDS,
  );
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.16;
  master.connect(compressor).connect(context.destination);

  const foundation = context.createOscillator();
  const foundationGain = context.createGain();
  foundation.type = "sine";
  foundation.frequency.setValueCurveAtTime(
    automation.foundationFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  foundationGain.gain.setValueCurveAtTime(
    automation.foundationGain,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  foundation.connect(foundationGain).connect(master);
  foundation.start(startedAt);
  foundation.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(foundation);
  processors.push(foundationGain);

  const aura = context.createOscillator();
  const auraGain = context.createGain();
  aura.type = "sine";
  aura.frequency.setValueCurveAtTime(
    automation.auraFrequency,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  auraGain.gain.setValueCurveAtTime(
    automation.auraGain,
    startedAt,
    BUILD_UP_DURATION_SECONDS,
  );
  aura.connect(auraGain).connect(master);
  aura.start(startedAt);
  aura.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(aura);
  processors.push(auraGain);

  if (textureBuffer) {
    const texture = context.createBufferSource();
    const airFilter = context.createBiquadFilter();
    const airGain = context.createGain();
    const shimmerFilter = context.createBiquadFilter();
    const shimmerGain = context.createGain();
    texture.buffer = textureBuffer;
    texture.loop = true;
    airFilter.type = "bandpass";
    airFilter.Q.value = 0.62;
    airFilter.frequency.setValueCurveAtTime(
      automation.airFrequency,
      startedAt,
      BUILD_UP_DURATION_SECONDS,
    );
    airGain.gain.setValueCurveAtTime(
      automation.airGain,
      startedAt,
      BUILD_UP_DURATION_SECONDS,
    );
    shimmerFilter.type = "bandpass";
    shimmerFilter.Q.value = 1.05;
    shimmerFilter.frequency.setValueCurveAtTime(
      automation.shimmerFrequency,
      startedAt,
      BUILD_UP_DURATION_SECONDS,
    );
    shimmerGain.gain.setValueCurveAtTime(
      automation.shimmerGain,
      startedAt,
      BUILD_UP_DURATION_SECONDS,
    );
    texture.connect(airFilter).connect(airGain).connect(master);
    texture.connect(shimmerFilter).connect(shimmerGain).connect(master);
    texture.start(startedAt);
    texture.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
    nodes.push(texture);
    processors.push(airFilter, airGain, shimmerFilter, shimmerGain);
  }

  return () => {
    nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Scheduled nodes may already have stopped naturally.
      }
      node.disconnect();
    });
    processors.forEach((processor) => processor.disconnect());
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
