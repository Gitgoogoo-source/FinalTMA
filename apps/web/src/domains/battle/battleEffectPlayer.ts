import "./ui/battle-effects.css";

type EffectElement = "fire" | "grass" | "earth" | "lightning" | "water";

type TrajectoryKey =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10";

type ElementStyle = {
  primary: string;
  secondary: string;
  glow: string;
};

export type BattleEffect = {
  element: EffectElement;
  trajectory: TrajectoryKey;
};

type EffectMotion = (
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
) => Animation[];

const elementEffects: Record<EffectElement, ElementStyle> = {
  fire: { primary: "#ff6a2b", secondary: "#ffd166", glow: "#c92d12" },
  grass: { primary: "#38d27a", secondary: "#c7f36b", glow: "#0b754c" },
  earth: { primary: "#c98a49", secondary: "#f2d28f", glow: "#69452a" },
  lightning: { primary: "#ffe14f", secondary: "#dff8ff", glow: "#2588d8" },
  water: { primary: "#42c7ff", secondary: "#d8f8ff", glow: "#1768bd" },
};

const castMotions: Record<TrajectoryKey, EffectMotion> = {
  "01": singleDashCast,
  "02": doubleDashCast,
  "03": zigzagCast,
  "04": fireballCast,
  "05": ringCharge,
  "06": verticalCharge,
  "07": radialCharge,
  "08": horizontalStreamCast,
  "09": stormCharge,
  "10": skyfallCharge,
};

const impactMotions: Record<TrajectoryKey, EffectMotion> = {
  "01": singleDashImpact,
  "02": doubleDashImpact,
  "03": zigzagImpact,
  "04": fireballImpact,
  "05": ringImpact,
  "06": verticalImpact,
  "07": radialImpact,
  "08": horizontalStreamImpact,
  "09": stormImpact,
  "10": skyfallImpact,
};

const missMotions: Record<TrajectoryKey, EffectMotion> = {
  "01": singleDashMiss,
  "02": doubleDashMiss,
  "03": zigzagMiss,
  "04": fireballMiss,
  "05": ringMiss,
  "06": verticalMiss,
  "07": radialMiss,
  "08": horizontalStreamMiss,
  "09": stormMiss,
  "10": skyfallMiss,
};

export function parseBattleEffectKey(key: string): BattleEffect | null {
  const match = /^(fire|grass|earth|lightning|water)-(0[1-9]|10)$/.exec(key);
  if (!match) return null;
  const element = match[1];
  const trajectory = match[2];
  if (
    !element ||
    !trajectory ||
    !isEffectElement(element) ||
    !isTrajectory(trajectory)
  )
    return null;
  return { element, trajectory };
}

export async function playBattleEffectCast(
  arena: HTMLDivElement,
  actor: HTMLElement | null,
  effect: BattleEffect,
): Promise<void> {
  const layer = effectLayer(arena);
  if (!layer) return;
  clearLayerAnimations(layer);
  prepareLayer(layer, effect, "cast");
  const direction = attackDirection(actor);
  const pieces = effectPieces(layer);
  const animations = castMotions[effect.trajectory](pieces, direction);
  if (actor) animations.push(actorCastPulse(actor));
  await waitForAnimations(animations);
}

export async function playBattleEffectOutcome(
  arena: HTMLDivElement,
  target: HTMLElement | null,
  effect: BattleEffect,
  hit: boolean,
  knockout: boolean,
): Promise<void> {
  const layer = effectLayer(arena);
  if (!layer) {
    if (hit && target) await playTargetReaction(target, knockout);
    return;
  }
  clearLayerAnimations(layer);
  prepareLayer(layer, effect, hit ? "impact" : "miss");
  const direction = attackDirectionFromTarget(target);
  const pieces = effectPieces(layer);
  const effectAnimations = (hit ? impactMotions : missMotions)[
    effect.trajectory
  ](pieces, direction);
  const targetReaction =
    hit && target ? playTargetReaction(target, knockout) : Promise.resolve();
  await Promise.all([waitForAnimations(effectAnimations), targetReaction]);
  clearBattleEffectLayer(arena);
}

export function clearBattleEffectLayer(arena: HTMLDivElement | null): void {
  if (!arena) return;
  const layer = effectLayer(arena);
  if (!layer) return;
  clearLayerAnimations(layer);
  delete layer.dataset.element;
  delete layer.dataset.phase;
  delete layer.dataset.trajectory;
  layer.style.removeProperty("--battle-effect-primary");
  layer.style.removeProperty("--battle-effect-secondary");
  layer.style.removeProperty("--battle-effect-glow");
}

function prepareLayer(
  layer: HTMLElement,
  effect: BattleEffect,
  phase: "cast" | "impact" | "miss",
): void {
  const colors = elementEffects[effect.element];
  layer.dataset.element = effect.element;
  layer.dataset.phase = phase;
  layer.dataset.trajectory = effect.trajectory;
  layer.style.setProperty("--battle-effect-primary", colors.primary);
  layer.style.setProperty("--battle-effect-secondary", colors.secondary);
  layer.style.setProperty("--battle-effect-glow", colors.glow);
}

function singleDashCast(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const trail = Math.max(0, index - 1) * 9;
    const lane = ((index % 3) - 1) * 4;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 1 : 0,
          transform: `translate3d(${startX}px, ${startY + lane}px, 0) rotate(${rotation}deg) scaleX(.25)`,
        },
        {
          opacity: 1,
          offset: 0.28 + Math.min(index, 7) * 0.025,
          transform: `translate3d(${startX + (targetX - startX) * 0.46 + direction * trail}px, ${startY + (targetY - startY) * 0.46 + lane}px, 0) rotate(${rotation}deg) scaleX(1)`,
        },
        {
          opacity: index < 2 ? 1 : 0.18,
          transform: `translate3d(${targetX + direction * trail}px, ${targetY + lane}px, 0) rotate(${rotation}deg) scaleX(${index < 2 ? 1 : 0.55})`,
        },
      ],
      {
        duration: index < 2 ? 360 : 300,
        delay: index < 2 ? index * 14 : 38 + (index - 2) * 14,
        easing: "steps(8, end)",
        fill: "both",
      },
    );
  });
}

function singleDashImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const shardAngle = rotation - 60 + index * 12;
    const distance = index < 2 ? 0 : 28 + (index % 4) * 8;
    return piece.animate(
      [
        {
          opacity: 1,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${index < 2 ? rotation : shardAngle}deg) scale(.35)`,
        },
        {
          opacity: 1,
          offset: 0.42,
          transform: `translate3d(${targetX - direction * distance}px, ${targetY + Math.sin((shardAngle * Math.PI) / 180) * distance}px, 0) rotate(${index < 2 ? rotation : shardAngle}deg) scale(${index === 0 ? 1.45 : 1})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * (distance + 12)}px, ${targetY + Math.sin((shardAngle * Math.PI) / 180) * (distance + 12)}px, 0) rotate(${index < 2 ? rotation : shardAngle}deg) scale(.3)`,
        },
      ],
      { duration: 230, easing: "steps(5, end)", fill: "both" },
    );
  });
}

function singleDashMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const lane = ((index % 3) - 1) * 5;
    const overrun = 62 + index * 5;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 1 : 0.55,
          transform: `translate3d(${targetX}px, ${targetY + lane}px, 0) rotate(${rotation}deg) scaleX(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * overrun}px, ${targetY + direction * 34 + lane}px, 0) rotate(${rotation}deg) scaleX(.45)`,
        },
      ],
      {
        duration: 190,
        delay: index * 8,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function doubleDashCast(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const wave = index < 6 ? -1 : 1;
    const lane = wave * (12 + (index % 3) * 2);
    const delay = wave < 0 ? index * 9 : 92 + (index - 6) * 9;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${startX}px, ${startY + lane}px, 0) rotate(${rotation + wave * 5}deg) scaleX(.2)`,
        },
        {
          opacity: 1,
          offset: 0.32,
          transform: `translate3d(${startX + (targetX - startX) * 0.52}px, ${startY + (targetY - startY) * 0.52 + lane}px, 0) rotate(${rotation + wave * 5}deg) scaleX(1)`,
        },
        {
          opacity: index % 6 < 2 ? 1 : 0.22,
          transform: `translate3d(${targetX}px, ${targetY + lane * 0.35}px, 0) rotate(${rotation + wave * 5}deg) scaleX(.72)`,
        },
      ],
      {
        duration: 330,
        delay,
        easing: "steps(7, end)",
        fill: "both",
      },
    );
  });
}

function doubleDashImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const wave = index < 6 ? -1 : 1;
    const angle = attackAngle(direction) + wave * 48;
    const distance = index % 6 < 2 ? 42 : 22 + (index % 3) * 9;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) scaleX(.15)`,
        },
        {
          opacity: 1,
          transform: `translate3d(${targetX - direction * wave * 8}px, ${targetY + wave * 5}px, 0) rotate(${angle}deg) scaleX(${index % 6 < 2 ? 1.5 : 1})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * distance}px, ${targetY + wave * distance * 0.55}px, 0) rotate(${angle}deg) scaleX(.4)`,
        },
      ],
      {
        duration: 250,
        delay: wave > 0 ? 48 : 0,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function doubleDashMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const wave = index < 6 ? -1 : 1;
    const angle = attackAngle(direction) + wave * 18;
    return piece.animate(
      [
        {
          opacity: 0.8,
          transform: `translate3d(${targetX}px, ${targetY + wave * 10}px, 0) rotate(${angle}deg) scaleX(.8)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * (54 + index * 3)}px, ${targetY + wave * (42 + index * 2)}px, 0) rotate(${angle + wave * 12}deg) scaleX(.25)`,
        },
      ],
      {
        duration: 220,
        delay: (index % 6) * 9,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function zigzagCast(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const jitter = ((index % 4) - 1.5) * 4;
    const delay = index * 11;
    return piece.animate(
      [
        {
          opacity: index < 3 ? 1 : 0,
          transform: `translate3d(${startX}px, ${startY + jitter}px, 0) rotate(${direction * 18}deg) scale(.35)`,
        },
        {
          opacity: 1,
          offset: 0.32,
          transform: `translate3d(${startX + (targetX - startX) * 0.34 - direction * 38}px, ${startY + (targetY - startY) * 0.34 - direction * 30 + jitter}px, 0) rotate(${direction * -42}deg) scale(1)`,
        },
        {
          opacity: 1,
          offset: 0.66,
          transform: `translate3d(${startX + (targetX - startX) * 0.68 + direction * 30}px, ${startY + (targetY - startY) * 0.68 + direction * 24 + jitter}px, 0) rotate(${direction * 38}deg) scale(.85)`,
        },
        {
          opacity: index < 3 ? 1 : 0.18,
          transform: `translate3d(${targetX}px, ${targetY + jitter}px, 0) rotate(${attackAngle(direction)}deg) scale(.65)`,
        },
      ],
      {
        duration: 480,
        delay,
        easing: "steps(9, end)",
        fill: "both",
      },
    );
  });
}

function zigzagImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = -150 + index * 27;
    const distance = 32 + (index % 4) * 9;
    return piece.animate(
      [
        {
          opacity: 1,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) scale(.25)`,
        },
        {
          opacity: 1,
          offset: 0.38,
          transform: `translate3d(${targetX + Math.cos((angle * Math.PI) / 180) * distance}px, ${targetY + Math.sin((angle * Math.PI) / 180) * distance}px, 0) rotate(${angle + direction * 35}deg) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX + Math.cos((angle * Math.PI) / 180) * (distance + 14)}px, ${targetY + Math.sin((angle * Math.PI) / 180) * (distance + 14)}px, 0) rotate(${angle + direction * 70}deg) scale(.35)`,
        },
      ],
      {
        duration: 270,
        delay: (index % 3) * 18,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function zigzagMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const bend = index % 2 === 0 ? -1 : 1;
    return piece.animate(
      [
        {
          opacity: 0.85,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${direction * 32}deg) scale(.7)`,
        },
        {
          opacity: 0.55,
          transform: `translate3d(${targetX + direction * bend * 34}px, ${targetY - direction * 26}px, 0) rotate(${direction * -48}deg) scale(.55)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * (58 + index * 3)}px, ${targetY + bend * (46 + index * 2)}px, 0) rotate(${direction * 74}deg) scale(.2)`,
        },
      ],
      {
        duration: 250,
        delay: index * 7,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function fireballCast(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  const animations: Animation[] = [];
  for (const [index, piece] of pieces.entries()) {
    const isCore = index < 3;
    const trailOffset = Math.max(0, index - 2) * 7;
    const xEnd = targetX + direction * trailOffset;
    const yEnd = targetY - direction * trailOffset * 0.55;
    animations.push(
      piece.animate(
        [
          {
            opacity: isCore ? 1 : 0,
            transform: `translate3d(${startX}px, ${startY}px, 0) scale(${isCore ? 0.35 : 0.15})`,
          },
          {
            opacity: 1,
            offset: 0.35 + Math.min(index, 8) * 0.025,
            transform: `translate3d(${startX + (xEnd - startX) * 0.45}px, ${startY + (yEnd - startY) * 0.45}px, 0) scale(${isCore ? 0.75 : 1})`,
          },
          {
            opacity: isCore ? 1 : 0.12,
            transform: `translate3d(${xEnd}px, ${yEnd}px, 0) scale(${isCore ? 1 : 0.55})`,
          },
        ],
        {
          duration: isCore ? 540 : 430,
          delay: isCore ? index * 18 : 70 + (index - 3) * 24,
          easing: "steps(10, end)",
          fill: "both",
        },
      ),
    );
  }
  return animations;
}

function fireballImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = ((index - 3) / Math.max(1, pieces.length - 4)) * Math.PI * 2;
    const distance = index < 3 ? 0 : 34 + (index % 3) * 10;
    const x = targetX + Math.cos(angle) * distance;
    const y = targetY + Math.sin(angle) * distance;
    return piece.animate(
      [
        {
          opacity: 1,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(${index < 3 ? 0.6 : 0.3})`,
        },
        {
          opacity: index === 2 ? 0.9 : 1,
          offset: 0.45,
          transform: `translate3d(${index < 3 ? targetX : x}px, ${index < 3 ? targetY : y}px, 0) scale(${index === 2 ? 1.7 : 1})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${index < 3 ? targetX : x}px, ${index < 3 ? targetY : y}px, 0) scale(${index === 2 ? 2.15 : 0.35})`,
        },
      ],
      { duration: 260, easing: "steps(5, end)", fill: "both" },
    );
  });
}

function fireballMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const trail = Math.max(0, index - 2) * 6;
    return piece.animate(
      [
        {
          opacity: index < 3 ? 1 : 0.55,
          transform: `translate3d(${targetX + direction * trail}px, ${targetY - direction * trail * 0.5}px, 0) scale(${index < 3 ? 1 : 0.6})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * (72 + index * 4)}px, ${targetY + direction * (34 + index * 2)}px, 0) scale(${index < 3 ? 0.45 : 0.2})`,
        },
      ],
      {
        duration: 220,
        delay: index * 9,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function ringCharge(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = ((index - 2) / Math.max(1, pieces.length - 2)) * Math.PI * 2;
    const orbit = 24 + (index % 3) * 5;
    const startOrbitX = startX + Math.cos(angle) * orbit;
    const startOrbitY = startY + Math.sin(angle) * orbit;
    const targetOrbitX = targetX + Math.cos(angle + direction * 1.4) * orbit;
    const targetOrbitY = targetY + Math.sin(angle + direction * 1.4) * orbit;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 0.65 : 0,
          transform: `translate3d(${startX}px, ${startY}px, 0) rotate(0deg) scale(.2)`,
        },
        {
          opacity: 1,
          offset: 0.32,
          transform: `translate3d(${startOrbitX}px, ${startOrbitY}px, 0) rotate(${direction * 90}deg) scale(.72)`,
        },
        {
          opacity: 1,
          offset: 0.72,
          transform: `translate3d(${startX + (targetX - startX) * 0.66 + Math.cos(angle + direction * 0.8) * orbit}px, ${startY + (targetY - startY) * 0.66 + Math.sin(angle + direction * 0.8) * orbit}px, 0) rotate(${direction * 220}deg) scale(1)`,
        },
        {
          opacity: index < 2 ? 0.85 : 0.5,
          transform: `translate3d(${targetOrbitX}px, ${targetOrbitY}px, 0) rotate(${direction * 320}deg) scale(${index < 2 ? 1 : 0.55})`,
        },
      ],
      {
        duration: 560,
        delay: index < 2 ? index * 20 : 42 + (index - 2) * 10,
        easing: "steps(10, end)",
        fill: "both",
      },
    );
  });
}

function ringImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    if (index < 2)
      return piece.animate(
        [
          {
            opacity: 0.9,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${direction * index * 45}deg) scale(.3)`,
          },
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${direction * (120 + index * 70)}deg) scale(${1.1 + index * 0.35})`,
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${direction * (220 + index * 90)}deg) scale(${1.7 + index * 0.45})`,
          },
        ],
        {
          duration: 320,
          delay: index * 42,
          easing: "steps(6, end)",
          fill: "both",
        },
      );
    const angle = ((index - 2) / Math.max(1, pieces.length - 2)) * Math.PI * 2;
    const distance = 38 + (index % 4) * 7;
    return piece.animate(
      [
        {
          opacity: 1,
          transform: `translate3d(${targetX + Math.cos(angle) * 18}px, ${targetY + Math.sin(angle) * 18}px, 0) rotate(${direction * 180}deg) scale(.45)`,
        },
        {
          opacity: 1,
          offset: 0.48,
          transform: `translate3d(${targetX + Math.cos(angle) * distance}px, ${targetY + Math.sin(angle) * distance}px, 0) rotate(${direction * 320}deg) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX + Math.cos(angle) * (distance + 12)}px, ${targetY + Math.sin(angle) * (distance + 12)}px, 0) rotate(${direction * 420}deg) scale(.25)`,
        },
      ],
      { duration: 280, easing: "steps(6, end)", fill: "both" },
    );
  });
}

function ringMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = (index / Math.max(1, pieces.length)) * Math.PI * 2;
    const shift = 52 + (index % 3) * 7;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 0.8 : 0.55,
          transform: `translate3d(${targetX + Math.cos(angle) * 24}px, ${targetY + Math.sin(angle) * 24}px, 0) rotate(${direction * 280}deg) scale(.8)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * shift + Math.cos(angle) * 28}px, ${targetY + direction * 42 + Math.sin(angle) * 28}px, 0) rotate(${direction * 440}deg) scale(.25)`,
        },
      ],
      {
        duration: 240,
        delay: index * 8,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function verticalCharge(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const spread = ((index % 5) - 2) * 13;
    const ceiling = targetY - 150 - (index % 3) * 12;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX + spread * 2}px, ${ceiling - 28}px, 0) scaleY(.15)`,
        },
        {
          opacity: index < 2 ? 0.8 : 1,
          transform: `translate3d(${targetX + spread}px, ${ceiling}px, 0) scaleY(${index < 2 ? 0.7 : 1})`,
        },
        {
          opacity: index < 2 ? 0.9 : 0.45,
          transform: `translate3d(${targetX + spread * 0.25}px, ${targetY - 76 - (index % 2) * 9}px, 0) scaleY(${index < 2 ? 1 : 0.45})`,
        },
      ],
      {
        duration: 440,
        delay: (index % 4) * 20,
        easing: "steps(8, end)",
        fill: "both",
      },
    );
  });
}

function verticalImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    if (index < 2)
      return piece.animate(
        [
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY - 112}px, 0) scaleY(.45)`,
            transformOrigin: "50% 100%",
          },
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY - 30}px, 0) scaleY(${index === 0 ? 1.25 : 1})`,
            transformOrigin: "50% 100%",
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY - 12}px, 0) scaleY(.45)`,
            transformOrigin: "50% 100%",
          },
        ],
        {
          duration: 290,
          delay: index * 25,
          easing: "steps(6, end)",
          fill: "both",
        },
      );
    const side = index % 2 === 0 ? -1 : 1;
    const distance = 28 + (index % 5) * 8;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(0deg) scale(.3)`,
        },
        {
          opacity: 1,
          offset: 0.38,
          transform: `translate3d(${targetX + side * distance}px, ${targetY - 12 - (index % 3) * 7}px, 0) rotate(${side * 55}deg) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX + side * (distance + 14)}px, ${targetY + 12 + (index % 3) * 5}px, 0) rotate(${side * 95}deg) scale(.35)`,
        },
      ],
      {
        duration: 270,
        delay: 70 + (index % 2) * 18,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function verticalMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const missX = targetX + direction * 62;
  return pieces.map((piece, index) => {
    const side = ((index % 3) - 1) * 8;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 1 : 0.55,
          transform: `translate3d(${targetX + side}px, ${targetY - 86}px, 0) scaleY(.7)`,
        },
        {
          opacity: 0.85,
          transform: `translate3d(${missX + side}px, ${targetY + 8}px, 0) scaleY(${index < 2 ? 1 : 0.55})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${missX + side * 1.6}px, ${targetY + 28}px, 0) scaleY(.2)`,
        },
      ],
      {
        duration: 250,
        delay: index * 9,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function radialCharge(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const offset = index < 2 ? 0 : (index - 5.5) * 5;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 1 : 0,
          transform: `translate3d(${startX}px, ${startY}px, 0) scale(.2)`,
        },
        {
          opacity: 1,
          transform: `translate3d(${targetX + offset}px, ${targetY - Math.abs(offset) * 0.3}px, 0) scale(${index < 2 ? 0.8 : 0.45})`,
        },
      ],
      {
        duration: 430,
        delay: index < 2 ? index * 22 : 80 + index * 12,
        easing: "steps(8, end)",
        fill: "both",
      },
    );
  });
}

function radialImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    if (index === 0)
      return piece.animate(
        [
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(.25)`,
          },
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(1.3)`,
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(.7)`,
          },
        ],
        { duration: 280, easing: "steps(5, end)", fill: "both" },
      );
    const angle = ((index - 1) / Math.max(1, pieces.length - 1)) * 360;
    const distance = index > 8 ? 36 : 58;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-8px) scaleY(.15)`,
        },
        {
          opacity: 1,
          offset: 0.35,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-${distance}px) scaleY(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-${distance + 12}px) scaleY(.72)`,
        },
      ],
      {
        duration: 300,
        delay: (index % 2) * 28,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function radialMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = ((index - 1) / Math.max(1, pieces.length - 1)) * 360;
    const retreat = 20 + (index % 4) * 6;
    return piece.animate(
      [
        {
          opacity: index === 0 ? 0.9 : 0.65,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-32px) scaleY(.75)`,
        },
        {
          opacity: 0.4,
          transform: `translate3d(${targetX - direction * 18}px, ${targetY + direction * 14}px, 0) rotate(${angle - direction * 35}deg) translateY(-${retreat}px) scaleY(.35)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * 42}px, ${targetY + direction * 36}px, 0) rotate(${angle - direction * 70}deg) translateY(-8px) scaleY(.1)`,
        },
      ],
      {
        duration: 230,
        delay: (index % 3) * 12,
        easing: "steps(5, end)",
        fill: "both",
      },
    );
  });
}

function horizontalStreamCast(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { startX, startY, targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const lane = ((index % 4) - 1.5) * 12;
    const lag = Math.floor(index / 4) * 28;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${startX + direction * lag}px, ${startY + lane}px, 0) rotate(${rotation}deg) scaleX(.15)`,
        },
        {
          opacity: 1,
          offset: 0.35,
          transform: `translate3d(${startX + (targetX - startX) * 0.48 + direction * lag * 0.45}px, ${startY + (targetY - startY) * 0.48 + lane}px, 0) rotate(${rotation}deg) scaleX(${index < 4 ? 1.35 : 1})`,
        },
        {
          opacity: index < 4 ? 0.95 : 0.3,
          transform: `translate3d(${targetX + direction * lag * 0.18}px, ${targetY + lane * 0.55}px, 0) rotate(${rotation}deg) scaleX(${index < 4 ? 1.1 : 0.55})`,
        },
      ],
      {
        duration: 470,
        delay: (index % 4) * 18 + Math.floor(index / 4) * 28,
        easing: "steps(9, end)",
        fill: "both",
      },
    );
  });
}

function horizontalStreamImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const lane = ((index % 4) - 1.5) * 13;
    const sweep = 74 + Math.floor(index / 4) * 18;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX + direction * sweep}px, ${targetY + lane}px, 0) rotate(${rotation}deg) scaleX(.25)`,
        },
        {
          opacity: 1,
          offset: 0.34,
          transform: `translate3d(${targetX}px, ${targetY + lane}px, 0) rotate(${rotation}deg) scaleX(${index < 4 ? 1.55 : 1})`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * sweep}px, ${targetY + lane * 0.65}px, 0) rotate(${rotation}deg) scaleX(.45)`,
        },
      ],
      {
        duration: 300,
        delay: (index % 4) * 14,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function horizontalStreamMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const rotation = attackAngle(direction);
  return pieces.map((piece, index) => {
    const bend = index % 2 === 0 ? -1 : 1;
    const lane = ((index % 4) - 1.5) * 10;
    return piece.animate(
      [
        {
          opacity: 0.85,
          transform: `translate3d(${targetX}px, ${targetY + lane}px, 0) rotate(${rotation}deg) scaleX(1)`,
        },
        {
          opacity: 0.55,
          transform: `translate3d(${targetX - direction * 34}px, ${targetY + bend * 34 + lane}px, 0) rotate(${rotation + bend * 18}deg) scaleX(.75)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * (82 + index * 3)}px, ${targetY + bend * (56 + index * 2) + lane}px, 0) rotate(${rotation + bend * 28}deg) scaleX(.25)`,
        },
      ],
      {
        duration: 250,
        delay: (index % 4) * 12,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function stormCharge(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = (index / pieces.length) * Math.PI * 2;
    const radiusX = 118 - (index % 3) * 12;
    const radiusY = 76 - (index % 4) * 7;
    const midAngle = angle + direction * 2.15;
    const endAngle = angle + direction * 4.15;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${Math.cos(angle) * radiusX}px, ${Math.sin(angle) * radiusY}px, 0) rotate(0deg) scale(.35)`,
        },
        {
          opacity: 1,
          offset: 0.36,
          transform: `translate3d(${Math.cos(midAngle) * radiusX}px, ${Math.sin(midAngle) * radiusY}px, 0) rotate(${direction * 150}deg) scale(1)`,
        },
        {
          opacity: 0.85,
          offset: 0.72,
          transform: `translate3d(${targetX * 0.55 + Math.cos(endAngle) * radiusX * 0.52}px, ${targetY * 0.55 + Math.sin(endAngle) * radiusY * 0.52}px, 0) rotate(${direction * 310}deg) scale(.75)`,
        },
        {
          opacity: 0.5,
          transform: `translate3d(${targetX + Math.cos(endAngle) * 22}px, ${targetY + Math.sin(endAngle) * 17}px, 0) rotate(${direction * 420}deg) scale(.45)`,
        },
      ],
      {
        duration: 650,
        delay: (index % 4) * 18,
        easing: "steps(12, end)",
        fill: "both",
      },
    );
  });
}

function stormImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = (index / pieces.length) * Math.PI * 2;
    const startRadius = 44 + (index % 3) * 8;
    const endRadius = 78 + (index % 4) * 10;
    return piece.animate(
      [
        {
          opacity: 0.75,
          transform: `translate3d(${targetX + Math.cos(angle) * startRadius}px, ${targetY + Math.sin(angle) * startRadius * 0.7}px, 0) rotate(${direction * 360}deg) scale(.75)`,
        },
        {
          opacity: 1,
          offset: 0.36,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${direction * 470}deg) scale(1.2)`,
        },
        {
          opacity: 0.9,
          offset: 0.62,
          transform: `translate3d(${targetX + Math.cos(angle + 1.2) * endRadius}px, ${targetY + Math.sin(angle + 1.2) * endRadius * 0.72}px, 0) rotate(${direction * 570}deg) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX + Math.cos(angle + 1.2) * (endRadius + 18)}px, ${targetY + Math.sin(angle + 1.2) * (endRadius + 18) * 0.72}px, 0) rotate(${direction * 650}deg) scale(.3)`,
        },
      ],
      {
        duration: 380,
        delay: (index % 3) * 18,
        easing: "steps(8, end)",
        fill: "both",
      },
    );
  });
}

function stormMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const angle = (index / pieces.length) * Math.PI * 2;
    const radius = 46 + (index % 4) * 8;
    const driftAngle = angle - direction * 1.4;
    return piece.animate(
      [
        {
          opacity: 0.7,
          transform: `translate3d(${targetX + Math.cos(angle) * 24}px, ${targetY + Math.sin(angle) * 18}px, 0) rotate(${direction * 420}deg) scale(.65)`,
        },
        {
          opacity: 0.45,
          transform: `translate3d(${targetX - direction * 18 + Math.cos(driftAngle) * radius}px, ${targetY + direction * 16 + Math.sin(driftAngle) * radius * 0.7}px, 0) rotate(${direction * 500}deg) scale(.45)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX - direction * 42 + Math.cos(driftAngle) * (radius + 24)}px, ${targetY + direction * 38 + Math.sin(driftAngle) * (radius + 24) * 0.7}px, 0) rotate(${direction * 560}deg) scale(.15)`,
        },
      ],
      {
        duration: 300,
        delay: index * 8,
        easing: "steps(7, end)",
        fill: "both",
      },
    );
  });
}

function skyfallCharge(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const spread = (index - 5.5) * 14;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX + spread}px, -154px, 0) scale(.25)`,
        },
        {
          opacity: index < 2 ? 0.25 : 1,
          transform: `translate3d(${targetX + spread * 0.18}px, -126px, 0) scale(${index < 2 ? 0.35 : 1})`,
        },
        {
          opacity: index < 2 ? 0.45 : 0.75,
          transform: `translate3d(${targetX}px, -112px, 0) scale(${index < 2 ? 0.55 : 0.45})`,
        },
      ],
      {
        duration: 460,
        delay: (index % 4) * 24,
        easing: "steps(8, end)",
        fill: "both",
      },
    );
  });
}

function skyfallImpact(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    if (index === 0)
      return piece.animate(
        [
          {
            opacity: 0.8,
            transform: `translate3d(${targetX}px, ${targetY - 118}px, 0) scaleY(.05)`,
            transformOrigin: "50% 100%",
          },
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY - 58}px, 0) scaleY(1)`,
            transformOrigin: "50% 100%",
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY - 42}px, 0) scaleY(.72)`,
            transformOrigin: "50% 100%",
          },
        ],
        { duration: 340, easing: "steps(7, end)", fill: "both" },
      );
    if (index === 1)
      return piece.animate(
        [
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY + 4}px, 0) scale(.2)`,
          },
          {
            opacity: 1,
            transform: `translate3d(${targetX}px, ${targetY + 4}px, 0) scale(1)`,
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY + 4}px, 0) scale(1.55)`,
          },
        ],
        {
          duration: 320,
          delay: 90,
          easing: "steps(6, end)",
          fill: "both",
        },
      );
    const splashIndex = index - 2;
    const angle = -70 + (splashIndex / Math.max(1, pieces.length - 3)) * 140;
    const distance = 44 + (index % 3) * 9;
    return piece.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(0) scaleY(.2)`,
        },
        {
          opacity: 1,
          offset: 0.45,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-${distance}px) scaleY(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${angle}deg) translateY(-${distance + 14}px) scaleY(.5)`,
        },
      ],
      {
        duration: 300,
        delay: 80 + (index % 2) * 24,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function skyfallMiss(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  return pieces.map((piece, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const breakY = targetY - 54 - (index % 4) * 9;
    return piece.animate(
      [
        {
          opacity: index < 2 ? 0.9 : 0.65,
          transform: `translate3d(${targetX}px, ${breakY - 42}px, 0) scaleY(${index < 2 ? 0.8 : 0.5})`,
        },
        {
          opacity: 0.55,
          transform: `translate3d(${targetX + side * (24 + index * 3)}px, ${breakY}px, 0) rotate(${side * 24}deg) scaleY(.45)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${targetX + side * (54 + index * 4)}px, ${targetY - 18 + (index % 3) * 11}px, 0) rotate(${side * 58}deg) scale(.15)`,
        },
      ],
      {
        duration: 250,
        delay: index * 10,
        easing: "steps(6, end)",
        fill: "both",
      },
    );
  });
}

function actorCastPulse(actor: HTMLElement): Animation {
  return actor.animate(
    [
      { transform: "translate3d(0, 0, 0) scale(1)" },
      { transform: "translate3d(-3px, 2px, 0) scale(1.045)" },
      { transform: "translate3d(0, 0, 0) scale(1)" },
    ],
    { duration: 280, easing: "steps(4, end)" },
  );
}

async function playTargetReaction(
  target: HTMLElement,
  knockout: boolean,
): Promise<void> {
  await finished(
    target.animate(
      [
        { transform: "translateX(0)", filter: "brightness(1)" },
        { transform: "translateX(-7px)", filter: "brightness(1.5)" },
        { transform: "translateX(6px)", filter: "brightness(.8)" },
        { transform: "translateX(0)", filter: "brightness(1)" },
      ],
      { duration: 300, easing: "steps(5, end)" },
    ),
  );
  if (knockout)
    await finished(
      target.animate(
        [
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0.45, transform: "translateY(12px) scale(.92)" },
        ],
        { duration: 260, easing: "steps(4, end)", fill: "both" },
      ),
    );
}

function attackCoordinates(direction: 1 | -1): {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
} {
  return {
    startX: direction * 118,
    startY: -direction * 108,
    targetX: -direction * 112,
    targetY: direction * 86,
  };
}

function attackAngle(direction: 1 | -1): number {
  return direction === -1 ? -40 : 140;
}

function attackDirection(actor: HTMLElement | null): 1 | -1 {
  return actor
    ?.closest("[data-battle-actor]")
    ?.getAttribute("data-battle-actor") === "self"
    ? -1
    : 1;
}

function attackDirectionFromTarget(target: HTMLElement | null): 1 | -1 {
  return target
    ?.closest("[data-battle-actor]")
    ?.getAttribute("data-battle-actor") === "opponent"
    ? -1
    : 1;
}

function effectLayer(arena: HTMLDivElement): HTMLElement | null {
  return arena.querySelector<HTMLElement>("[data-battle-effect-layer]");
}

function effectPieces(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>("i")];
}

function clearLayerAnimations(layer: HTMLElement): void {
  layer.getAnimations({ subtree: true }).forEach((animation) => {
    animation.cancel();
  });
}

async function waitForAnimations(
  animations: readonly Animation[],
): Promise<void> {
  await Promise.all(animations.map(finished));
}

function finished(animation: Animation): Promise<void> {
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

function isEffectElement(value: string): value is EffectElement {
  return Object.hasOwn(elementEffects, value);
}

function isTrajectory(value: string): value is TrajectoryKey {
  return Object.hasOwn(castMotions, value);
}
