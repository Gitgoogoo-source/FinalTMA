type GachaRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

type AudioContextConstructor = new () => AudioContext;

let audioContext: AudioContext | null = null;
const activeSources = new Set<AudioScheduledSourceNode>();

function contextConstructor(): AudioContextConstructor | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext
  );
}

function getContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Constructor = contextConstructor();
  if (!Constructor) return null;
  try {
    audioContext = new Constructor();
    return audioContext;
  } catch {
    return null;
  }
}

function track(source: AudioScheduledSourceNode): void {
  activeSources.add(source);
  source.addEventListener(
    "ended",
    () => {
      activeSources.delete(source);
    },
    { once: true },
  );
}

function tone(
  context: AudioContext,
  start: number,
  duration: number,
  fromFrequency: number,
  toFrequency: number,
  volume: number,
  type: OscillatorType = "sine",
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(fromFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(toFrequency, 1),
    start + duration,
  );
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  track(oscillator);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function shimmer(
  context: AudioContext,
  start: number,
  duration: number,
  volume: number,
): void {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const envelope = 1 - index / frameCount;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(1_600, start);
  highpass.frequency.exponentialRampToValueAtTime(4_800, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(highpass).connect(gain).connect(context.destination);
  track(source);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function readyContext(): AudioContext | null {
  const context = getContext();
  return context?.state === "running" ? context : null;
}

export function primeGachaAudio(): void {
  const context = getContext();
  if (!context || context.state === "running") return;
  void context.resume().catch(() => undefined);
}

export function stopGachaAudio(): void {
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // A source may already have reached its scheduled end.
    }
  }
  activeSources.clear();
}

export function playGachaOpeningSound(): void {
  const context = readyContext();
  if (!context) return;
  const now = context.currentTime + 0.015;
  tone(context, now, 0.95, 138, 246, 0.055, "sine");
  tone(context, now + 0.28, 0.82, 392, 784, 0.035, "triangle");
  shimmer(context, now + 0.48, 0.72, 0.025);
}

export function playGachaRevealSound(rarity: GachaRarity): void {
  const context = readyContext();
  if (!context) return;
  const rank = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  }[rarity];
  const now = context.currentTime + 0.01;
  const base = 330 + rank * 58;
  const duration = 0.28 + rank * 0.055;
  tone(context, now, duration, base, base * 1.5, 0.038 + rank * 0.006, "sine");
  tone(
    context,
    now + 0.055,
    duration + 0.08,
    base * 1.5,
    base * 2,
    0.024 + rank * 0.005,
    "triangle",
  );
  if (rank >= 2)
    shimmer(context, now + 0.04, duration + 0.18, 0.018 + rank * 0.004);
}

export function playGachaSummarySound(): void {
  const context = readyContext();
  if (!context) return;
  const now = context.currentTime + 0.015;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    tone(
      context,
      now + index * 0.075,
      0.52,
      frequency,
      frequency * 1.01,
      0.032,
      "sine",
    );
  });
  shimmer(context, now, 0.62, 0.018);
}
