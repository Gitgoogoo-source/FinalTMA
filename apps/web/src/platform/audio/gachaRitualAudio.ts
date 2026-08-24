import {
  GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  GACHA_RITUAL_REVEAL_CAPSULE_POP,
  GACHA_RITUAL_REVEAL_MASTER_GAIN_CURVE,
  gachaRitualHeartbeatAt,
} from "./gachaRitualSoundDesign.ts";

const BUILD_UP_SOURCE_DURATION_SECONDS = 4.02;
const BUILD_UP_AUTOMATION_SAMPLE_COUNT = 2_001;
const BUILD_UP_PREPARATION_CHUNK_SIZE = 256;
const BUILD_UP_TEXTURE_SAMPLE_RATE = 12_000;
const BUILD_UP_TEXTURE_SAMPLE_COUNT = 16_384;
const BUILD_UP_TEXTURE_PREPARATION_CHUNK_SIZE = 2_048;
type BuildUpAutomation = {
  subFrequency: Float32Array;
  subGain: Float32Array;
  bodyFrequency: Float32Array;
  bodyGain: Float32Array;
  transientFrequency: Float32Array;
  transientGain: Float32Array;
  currentFrequency: Float32Array;
  currentGain: Float32Array;
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
        subFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        subGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        bodyFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        bodyGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        transientFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        transientGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        currentFrequency: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
        currentGain: new Float32Array(BUILD_UP_AUTOMATION_SAMPLE_COUNT),
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
      GACHA_RITUAL_BUILD_UP_DURATION_SECONDS;
    const { overall, primaryBeat, secondaryBeat, heartbeat, attack } =
      gachaRitualHeartbeatAt(seconds);
    const growth = Math.pow(overall, 0.86);

    automation.subFrequency[cursor] =
      52 + growth * 7 + primaryBeat * 34 + secondaryBeat * 23;
    automation.subGain[cursor] =
      0.0025 + growth * 0.0015 + heartbeat * (0.055 + growth * 0.012);
    automation.bodyFrequency[cursor] =
      116 + growth * 28 + primaryBeat * 72 + secondaryBeat * 48;
    automation.bodyGain[cursor] =
      0.0015 + growth * 0.002 + heartbeat * (0.026 + growth * 0.006);
    automation.transientFrequency[cursor] =
      520 + growth * 740 + attack * (700 + growth * 650);
    automation.transientGain[cursor] =
      0.0008 + growth * 0.0015 + attack * (0.017 + growth * 0.004);
    automation.currentFrequency[cursor] =
      1_800 + growth * 2_200 + heartbeat * 520;
    automation.currentGain[cursor] =
      0.0005 + growth * 0.0035 + heartbeat * (0.003 + growth * 0.002);
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
  master.gain.exponentialRampToValueAtTime(0.82, startedAt + 0.08);
  master.gain.setValueAtTime(0.82, startedAt + 3.9);
  master.gain.exponentialRampToValueAtTime(
    0.0001,
    startedAt + GACHA_RITUAL_BUILD_UP_DURATION_SECONDS - 0.001,
  );
  master.gain.setValueAtTime(
    0,
    startedAt + GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  );
  compressor.threshold.value = -22;
  compressor.knee.value = 16;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.12;
  master.connect(compressor).connect(context.destination);

  const sub = context.createOscillator();
  const subGain = context.createGain();
  sub.type = "sine";
  sub.frequency.setValueCurveAtTime(
    automation.subFrequency,
    startedAt,
    GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  );
  subGain.gain.setValueCurveAtTime(
    automation.subGain,
    startedAt,
    GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  );
  sub.connect(subGain).connect(master);
  sub.start(startedAt);
  sub.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(sub);
  processors.push(subGain);

  const body = context.createOscillator();
  const bodyFilter = context.createBiquadFilter();
  const bodyGain = context.createGain();
  body.type = "triangle";
  body.frequency.setValueCurveAtTime(
    automation.bodyFrequency,
    startedAt,
    GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  );
  bodyFilter.type = "lowpass";
  bodyFilter.frequency.value = 780;
  bodyFilter.Q.value = 0.72;
  bodyGain.gain.setValueCurveAtTime(
    automation.bodyGain,
    startedAt,
    GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  );
  body.connect(bodyFilter).connect(bodyGain).connect(master);
  body.start(startedAt);
  body.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
  nodes.push(body);
  processors.push(bodyFilter, bodyGain);

  if (textureBuffer) {
    const texture = context.createBufferSource();
    const transientFilter = context.createBiquadFilter();
    const transientGain = context.createGain();
    const currentFilter = context.createBiquadFilter();
    const currentGain = context.createGain();
    texture.buffer = textureBuffer;
    texture.loop = true;
    transientFilter.type = "bandpass";
    transientFilter.Q.value = 0.86;
    transientFilter.frequency.setValueCurveAtTime(
      automation.transientFrequency,
      startedAt,
      GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
    );
    transientGain.gain.setValueCurveAtTime(
      automation.transientGain,
      startedAt,
      GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
    );
    currentFilter.type = "highpass";
    currentFilter.Q.value = 0.72;
    currentFilter.frequency.setValueCurveAtTime(
      automation.currentFrequency,
      startedAt,
      GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
    );
    currentGain.gain.setValueCurveAtTime(
      automation.currentGain,
      startedAt,
      GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
    );
    texture.connect(transientFilter).connect(transientGain).connect(master);
    texture.connect(currentFilter).connect(currentGain).connect(master);
    texture.start(startedAt);
    texture.stop(startedAt + BUILD_UP_SOURCE_DURATION_SECONDS);
    nodes.push(texture);
    processors.push(transientFilter, transientGain, currentFilter, currentGain);
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

export function playGachaRitualReveal(): () => void {
  prepareGachaRitualAudioAssets();
  finishBuildUpAssetsPreparation();
  const context = getAudioContext();
  if (!context || context.state === "closed") return () => undefined;
  const textureBuffer = prepareBuildUpTextureBuffer(context);

  const startedAt = context.currentTime;
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const nodes: AudioScheduledSourceNode[] = [];
  const processors: AudioNode[] = [];
  scheduleRevealGain(
    master.gain,
    GACHA_RITUAL_REVEAL_MASTER_GAIN_CURVE,
    startedAt,
  );
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.07;
  master.connect(compressor).connect(context.destination);

  if (textureBuffer) {
    const texture = context.createBufferSource();
    texture.buffer = textureBuffer;
    GACHA_RITUAL_REVEAL_CAPSULE_POP.layers.forEach((layer) => {
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      filter.type = layer.type;
      filter.frequency.value = layer.frequency;
      filter.Q.value = layer.quality;
      scheduleRevealGain(gain.gain, layer.gainCurve, startedAt);
      texture.connect(filter).connect(gain).connect(master);
      processors.push(filter, gain);
    });
    texture.start(
      startedAt + GACHA_RITUAL_REVEAL_CAPSULE_POP.startAt,
      GACHA_RITUAL_REVEAL_CAPSULE_POP.textureOffset,
    );
    texture.stop(startedAt + GACHA_RITUAL_REVEAL_CAPSULE_POP.endAt);
    nodes.push(texture);
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

function scheduleRevealGain(
  parameter: AudioParam,
  curve: readonly (readonly [number, number])[],
  startedAt: number,
): void {
  curve.forEach(([seconds, value], index) => {
    if (index === 0) {
      parameter.setValueAtTime(value, startedAt + seconds);
      return;
    }
    parameter.exponentialRampToValueAtTime(value, startedAt + seconds);
  });
}
