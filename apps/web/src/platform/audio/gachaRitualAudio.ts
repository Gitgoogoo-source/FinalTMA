type GachaRitualRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

let audioContext: AudioContext | null = null;

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
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended")
    void context.resume().catch(() => undefined);
  if (context.state !== "running") return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.012);
}

export function playGachaRitualBuildUp(): () => void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return () => undefined;

  const startedAt = context.currentTime;
  const master = context.createGain();
  const nodes: OscillatorNode[] = [];
  master.gain.setValueAtTime(0.0001, startedAt);
  master.gain.exponentialRampToValueAtTime(0.052, startedAt + 3.18);
  master.gain.exponentialRampToValueAtTime(0.0001, startedAt + 3.3);
  master.connect(context.destination);

  const drone = context.createOscillator();
  drone.type = "sine";
  drone.frequency.setValueAtTime(72, startedAt);
  drone.frequency.exponentialRampToValueAtTime(124, startedAt + 3.2);
  drone.connect(master);
  drone.start(startedAt);
  drone.stop(startedAt + 3.32);
  nodes.push(drone);

  [0.42, 1.42, 2.5].forEach((offset, index) => {
    const pulse = context.createOscillator();
    const pulseGain = context.createGain();
    const pulseAt = startedAt + offset;
    pulse.type = index === 2 ? "triangle" : "sine";
    pulse.frequency.setValueAtTime(118 + index * 34, pulseAt);
    pulse.frequency.exponentialRampToValueAtTime(82, pulseAt + 0.22);
    pulseGain.gain.setValueAtTime(0.0001, pulseAt);
    pulseGain.gain.exponentialRampToValueAtTime(0.15, pulseAt + 0.025);
    pulseGain.gain.exponentialRampToValueAtTime(0.0001, pulseAt + 0.26);
    pulse.connect(pulseGain).connect(context.destination);
    pulse.start(pulseAt);
    pulse.stop(pulseAt + 0.28);
    nodes.push(pulse);
  });

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

export function playGachaRitualReveal(rarity: GachaRitualRarity): () => void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return () => undefined;

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
