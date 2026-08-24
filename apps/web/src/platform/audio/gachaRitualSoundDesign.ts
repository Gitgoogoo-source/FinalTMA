export const GACHA_RITUAL_BUILD_UP_DURATION_SECONDS = 4;
export const GACHA_RITUAL_REVEAL_DURATION_SECONDS = 0.7;

export type GachaRitualGainPoint = readonly [seconds: number, value: number];

export const GACHA_RITUAL_REVEAL_MASTER_GAIN_CURVE = [
  [0, 0.0001],
  [0.3, 0.0001],
  [0.301, 0.9],
  [0.36, 0.72],
  [0.46, 0.32],
  [0.52, 0.0001],
  [0.7, 0.0001],
] as const satisfies readonly GachaRitualGainPoint[];

export const GACHA_RITUAL_REVEAL_CAPSULE_POP = {
  startAt: 0.3,
  endAt: 0.52,
  textureOffset: 0.271,
  layers: [
    {
      type: "bandpass",
      frequency: 480,
      quality: 0.58,
      gainCurve: [
        [0.3, 0.0001],
        [0.301, 0.13],
        [0.306, 0.12],
        [0.322, 0.062],
        [0.355, 0.018],
        [0.405, 0.0001],
        [0.519, 0.0001],
      ],
    },
    {
      type: "bandpass",
      frequency: 1_750,
      quality: 0.9,
      gainCurve: [
        [0.3, 0.0001],
        [0.316, 0.0001],
        [0.318, 0.18],
        [0.325, 0.052],
        [0.349, 0.0001],
        [0.519, 0.0001],
      ],
    },
    {
      type: "highpass",
      frequency: 3_400,
      quality: 0.72,
      gainCurve: [
        [0.3, 0.0001],
        [0.317, 0.0001],
        [0.318, 0.13],
        [0.322, 0.06],
        [0.338, 0.0001],
        [0.519, 0.0001],
      ],
    },
  ],
} as const;

export const GACHA_RITUAL_BREATH_PERIODS_SECONDS = [
  0.8, 0.58, 0.46, 0.38, 0.33, 0.29, 0.26, 0.23, 0.2, 0.17, 0.13, 0.1, 0.07,
] as const;

export type GachaRitualHeartbeatFrame = {
  overall: number;
  primaryBeat: number;
  secondaryBeat: number;
  heartbeat: number;
  attack: number;
};

/**
 * One strong/soft electronic heartbeat pair is placed inside each visual
 * breath. The pair accelerates with the exact black-hole timeline while the
 * final short cycles broaden just enough to avoid single-sample clicks.
 */
export function gachaRitualHeartbeatAt(
  seconds: number,
): GachaRitualHeartbeatFrame {
  const elapsed = clamp(seconds, 0, GACHA_RITUAL_BUILD_UP_DURATION_SECONDS);
  let startedAt = 0;

  for (
    let index = 0;
    index < GACHA_RITUAL_BREATH_PERIODS_SECONDS.length;
    index += 1
  ) {
    const period = GACHA_RITUAL_BREATH_PERIODS_SECONDS[index] ?? 0.07;
    const endedAt = startedAt + period;
    if (
      elapsed < endedAt ||
      index === GACHA_RITUAL_BREATH_PERIODS_SECONDS.length - 1
    ) {
      const progress = clamp((elapsed - startedAt) / period, 0, 1);
      const width = clamp(0.016 / period, 0.055, 0.15);
      const primaryBeat = bell(progress, 0.18, width);
      const secondaryBeat = bell(progress, 0.42, width * 1.08);
      const heartbeat = clamp(
        Math.max(primaryBeat, secondaryBeat * 0.76),
        0,
        1,
      );

      return {
        overall: clamp(
          (index + progress) / GACHA_RITUAL_BREATH_PERIODS_SECONDS.length,
          0,
          1,
        ),
        primaryBeat,
        secondaryBeat,
        heartbeat,
        attack: clamp(Math.max(primaryBeat, secondaryBeat * 0.62), 0, 1),
      };
    }
    startedAt = endedAt;
  }

  return {
    overall: 1,
    primaryBeat: 0,
    secondaryBeat: 0,
    heartbeat: 0,
    attack: 0,
  };
}

function bell(value: number, center: number, width: number): number {
  const distance = (value - center) / Math.max(width, 0.0001);
  return Math.exp(-0.5 * distance * distance);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
