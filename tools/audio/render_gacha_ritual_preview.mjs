import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GACHA_RITUAL_BUILD_UP_DURATION_SECONDS,
  GACHA_RITUAL_REVEAL_CAPSULE_POP,
  GACHA_RITUAL_REVEAL_MASTER_GAIN_CURVE,
  GACHA_RITUAL_REVEAL_DURATION_SECONDS,
  gachaRitualHeartbeatAt,
} from "../../apps/web/src/platform/audio/gachaRitualSoundDesign.ts";

const SAMPLE_RATE = 48_000;
const CHANNEL_COUNT = 2;
const TEXTURE_SAMPLE_RATE = 12_000;
const TEXTURE_SAMPLE_COUNT = 16_384;
const BUILD_UP_TARGET_PEAK = 0.5075255346543961;
const REVEAL_TARGET_PEAK = 10 ** (-2 / 20);
const TOTAL_DURATION_SECONDS =
  GACHA_RITUAL_BUILD_UP_DURATION_SECONDS + GACHA_RITUAL_REVEAL_DURATION_SECONDS;
const TOTAL_SAMPLE_COUNT = Math.round(TOTAL_DURATION_SECONDS * SAMPLE_RATE);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(
  scriptDirectory,
  "../../.codex_tmp/gacha-unified-electronic-heartbeat-preview.wav",
);
const outputPath = resolve(process.argv[2] ?? defaultOutput);

class Biquad {
  constructor(type, frequency, quality) {
    this.input1 = 0;
    this.input2 = 0;
    this.output1 = 0;
    this.output2 = 0;
    this.configure(type, frequency, quality);
  }

  configure(type, frequency, quality) {
    const boundedFrequency = Math.min(
      SAMPLE_RATE * 0.49,
      Math.max(20, frequency),
    );
    const omega = (2 * Math.PI * boundedFrequency) / SAMPLE_RATE;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const alpha = sine / (2 * Math.max(0.01, quality));
    let b0;
    let b1;
    let b2;

    if (type === "lowpass") {
      b0 = (1 - cosine) / 2;
      b1 = 1 - cosine;
      b2 = (1 - cosine) / 2;
    } else if (type === "highpass") {
      b0 = (1 + cosine) / 2;
      b1 = -(1 + cosine);
      b2 = (1 + cosine) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }

    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cosine) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input) {
    const output =
      this.b0 * input +
      this.b1 * this.input1 +
      this.b2 * this.input2 -
      this.a1 * this.output1 -
      this.a2 * this.output2;
    this.input2 = this.input1;
    this.input1 = input;
    this.output2 = this.output1;
    this.output1 = output;
    return output;
  }
}

const texture = createTexture();
const samples = new Float64Array(TOTAL_SAMPLE_COUNT);
const buildUpFilters = {
  body: new Biquad("lowpass", 780, 0.72),
  transient: new Biquad("bandpass", 520, 0.86),
  current: new Biquad("highpass", 1_800, 0.72),
};
const revealCapsuleFilters = GACHA_RITUAL_REVEAL_CAPSULE_POP.layers.map(
  (layer) => new Biquad(layer.type, layer.frequency, layer.quality),
);

let subPhase = 0;
let bodyPhase = 0;

for (let index = 0; index < samples.length; index += 1) {
  const seconds = index / SAMPLE_RATE;
  if (seconds < GACHA_RITUAL_BUILD_UP_DURATION_SECONDS) {
    const { overall, primaryBeat, secondaryBeat, heartbeat, attack } =
      gachaRitualHeartbeatAt(seconds);
    const growth = overall ** 0.86;
    const subFrequency =
      52 + growth * 7 + primaryBeat * 34 + secondaryBeat * 23;
    const subGain =
      0.0025 + growth * 0.0015 + heartbeat * (0.055 + growth * 0.012);
    const bodyFrequency =
      116 + growth * 28 + primaryBeat * 72 + secondaryBeat * 48;
    const bodyGain =
      0.0015 + growth * 0.002 + heartbeat * (0.026 + growth * 0.006);
    const transientFrequency =
      520 + growth * 740 + attack * (700 + growth * 650);
    const transientGain =
      0.0008 + growth * 0.0015 + attack * (0.017 + growth * 0.004);
    const currentFrequency = 1_800 + growth * 2_200 + heartbeat * 520;
    const currentGain =
      0.0005 + growth * 0.0035 + heartbeat * (0.003 + growth * 0.002);
    const noise = textureAt(seconds);

    subPhase = advancePhase(subPhase, subFrequency);
    bodyPhase = advancePhase(bodyPhase, bodyFrequency);
    buildUpFilters.transient.configure("bandpass", transientFrequency, 0.86);
    buildUpFilters.current.configure("highpass", currentFrequency, 0.72);

    const signal =
      Math.sin(subPhase) * subGain +
      buildUpFilters.body.process(triangle(bodyPhase)) * bodyGain +
      buildUpFilters.transient.process(noise) * transientGain +
      buildUpFilters.current.process(noise) * currentGain;
    const master =
      seconds < 0.08
        ? exponentialRamp(0.0001, 0.82, seconds / 0.08)
        : seconds > 3.9
          ? exponentialRamp(0.82, 0.0001, (seconds - 3.9) / 0.1)
          : 0.82;
    samples[index] = softCompress(signal * master, 3.1);
    continue;
  }

  const revealSeconds = seconds - GACHA_RITUAL_BUILD_UP_DURATION_SECONDS;
  let signal = 0;

  if (
    revealSeconds >= GACHA_RITUAL_REVEAL_CAPSULE_POP.startAt &&
    revealSeconds < GACHA_RITUAL_REVEAL_CAPSULE_POP.endAt
  ) {
    const noise = textureAt(
      GACHA_RITUAL_REVEAL_CAPSULE_POP.textureOffset +
        revealSeconds -
        GACHA_RITUAL_REVEAL_CAPSULE_POP.startAt,
    );
    GACHA_RITUAL_REVEAL_CAPSULE_POP.layers.forEach((layer, layerIndex) => {
      const gain = piecewiseExponential(revealSeconds, layer.gainCurve);
      signal += revealCapsuleFilters[layerIndex].process(noise) * gain;
    });
  }

  const master = piecewiseExponential(
    revealSeconds,
    GACHA_RITUAL_REVEAL_MASTER_GAIN_CURVE,
  );
  samples[index] = softCompress(signal * master, 3.5);
}

normalizeSegment(
  samples,
  0,
  Math.round(GACHA_RITUAL_BUILD_UP_DURATION_SECONDS * SAMPLE_RATE),
  BUILD_UP_TARGET_PEAK,
);
normalizeSegment(
  samples,
  Math.round(GACHA_RITUAL_BUILD_UP_DURATION_SECONDS * SAMPLE_RATE),
  samples.length,
  REVEAL_TARGET_PEAK,
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, encodeWave(samples));

process.stdout.write(
  `${JSON.stringify(
    {
      path: outputPath,
      duration_seconds: TOTAL_DURATION_SECONDS,
      sample_rate_hz: SAMPLE_RATE,
      channels: CHANNEL_COUNT,
      heartbeat_pairs: 13,
      sound_variants: 1,
      peak_dbfs: Number((20 * Math.log10(REVEAL_TARGET_PEAK)).toFixed(2)),
      clipped_samples: 0,
    },
    null,
    2,
  )}\n`,
);

function createTexture() {
  const result = new Float64Array(TEXTURE_SAMPLE_COUNT);
  let randomState = 0x6d2b79f5;
  let color = 0;
  for (let index = 0; index < result.length; index += 1) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    const white = (randomState / 0xffffffff) * 2 - 1;
    color = color * 0.82 + white * 0.18;
    result[index] = white * 0.36 + color * 0.64;
  }
  return result;
}

function textureAt(seconds) {
  const position = (seconds * TEXTURE_SAMPLE_RATE) % texture.length;
  const lower = Math.floor(position);
  const upper = (lower + 1) % texture.length;
  const fraction = position - lower;
  return texture[lower] * (1 - fraction) + texture[upper] * fraction;
}

function advancePhase(phase, frequency) {
  return (phase + (Math.PI * 2 * frequency) / SAMPLE_RATE) % (Math.PI * 2);
}

function triangle(phase) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

function exponentialRamp(from, to, progress) {
  const amount = Math.min(1, Math.max(0, progress));
  return from * (to / from) ** amount;
}

function piecewiseExponential(seconds, points) {
  for (let index = 1; index < points.length; index += 1) {
    const [endTime, endValue] = points[index];
    const [startTime, startValue] = points[index - 1];
    if (seconds <= endTime) {
      return exponentialRamp(
        startValue,
        endValue,
        (seconds - startTime) / Math.max(0.000001, endTime - startTime),
      );
    }
  }
  return points.at(-1)[1];
}

function softCompress(value, drive) {
  return Math.tanh(value * drive) / Math.tanh(drive);
}

function normalizeSegment(values, start, end, targetPeak) {
  let measuredPeak = 0;
  for (let index = start; index < end; index += 1) {
    measuredPeak = Math.max(measuredPeak, Math.abs(values[index]));
  }
  const normalization = measuredPeak > 0 ? targetPeak / measuredPeak : 1;
  for (let index = start; index < end; index += 1) {
    values[index] *= normalization;
  }
}

function encodeWave(monoSamples) {
  const bytesPerSample = 2;
  const dataSize = monoSamples.length * CHANNEL_COUNT * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNEL_COUNT, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNEL_COUNT * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNEL_COUNT * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const sample of monoSamples) {
    const encoded = Math.round(Math.max(-1, Math.min(1, sample)) * 32_767);
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      buffer.writeInt16LE(encoded, offset);
      offset += bytesPerSample;
    }
  }
  return buffer;
}
