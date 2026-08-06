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

const elementEffects: Record<EffectElement, ElementStyle> = {
  fire: { primary: "#ff6a2b", secondary: "#ffd166", glow: "#c92d12" },
  grass: { primary: "#38d27a", secondary: "#c7f36b", glow: "#0b754c" },
  earth: { primary: "#c98a49", secondary: "#f2d28f", glow: "#69452a" },
  lightning: { primary: "#ffe14f", secondary: "#dff8ff", glow: "#2588d8" },
  water: { primary: "#42c7ff", secondary: "#d8f8ff", glow: "#1768bd" },
};

const trajectories: Record<TrajectoryKey, (direction: 1 | -1) => Keyframe[]> = {
  "01": (direction) => [
    {
      transform: `translate3d(${direction * 96}px, ${direction * -118}px, 0) scale(.45)`,
    },
    {
      transform: `translate3d(${direction * -96}px, ${direction * 18}px, 0) scale(1.1)`,
    },
  ],
  "02": (direction) => [
    {
      transform: `translate3d(${direction * 112}px, ${direction * -126}px, 0) scale(.5)`,
    },
    {
      transform: `translate3d(${direction * -38}px, ${direction * -54}px, 0) scale(.85)`,
    },
    {
      transform: `translate3d(${direction * -112}px, ${direction * 20}px, 0) scale(1.15)`,
    },
  ],
  "03": (direction) => [
    {
      transform: `translate3d(${direction * 112}px, ${direction * -130}px, 0) rotate(${direction * 18}deg)`,
    },
    {
      transform: `translate3d(${direction * -72}px, ${direction * -72}px, 0) rotate(${direction * -14}deg)`,
    },
    {
      transform: `translate3d(${direction * 24}px, ${direction * -20}px, 0) rotate(${direction * 7}deg)`,
    },
    {
      transform: `translate3d(${direction * -112}px, ${direction * 20}px, 0) rotate(0deg)`,
    },
  ],
  "04": (direction) => [
    {
      transform: `translate3d(${direction * 120}px, ${direction * -142}px, 0) scale(.2)`,
    },
    {
      transform: `translate3d(${direction * -112}px, ${direction * 18}px, 0) scale(1.25)`,
    },
  ],
  "05": (direction) => [
    {
      transform: `translate3d(${direction * 62}px, ${direction * -72}px, 0) scale(.25) rotate(0deg)`,
    },
    {
      transform: `translate3d(${direction * -102}px, ${direction * 18}px, 0) scale(1.45) rotate(${direction * 220}deg)`,
    },
  ],
  "06": (direction) => [
    { transform: `translate3d(${direction * -104}px, -164px, 0) scale(.55)` },
    {
      transform: `translate3d(${direction * -104}px, ${direction * 18}px, 0) scale(1.35)`,
    },
  ],
  "07": (direction) => [
    {
      transform: `translate3d(${direction * 48}px, ${direction * -12}px, 0) scale(.1)`,
    },
    {
      transform: `translate3d(${direction * -106}px, ${direction * 18}px, 0) scale(1.8)`,
    },
  ],
  "08": (direction) => [
    {
      transform: `translate3d(${direction * 170}px, ${direction * 12}px, 0) scaleX(.15)`,
    },
    { transform: `translate3d(0, ${direction * 18}px, 0) scaleX(1.55)` },
    {
      transform: `translate3d(${direction * -170}px, ${direction * 22}px, 0) scaleX(.35)`,
    },
  ],
  "09": (direction) => [
    {
      transform: `translate3d(0, ${direction * -8}px, 0) rotate(0deg) scale(.4)`,
    },
    {
      transform: `translate3d(${direction * -76}px, ${direction * 18}px, 0) rotate(${direction * 300}deg) scale(1.75)`,
    },
  ],
  "10": (direction) => [
    { transform: `translate3d(${direction * -106}px, -190px, 0) scale(1.7)` },
    {
      transform: `translate3d(${direction * -106}px, ${direction * 84}px, 0) scale(.55)`,
    },
    {
      transform: `translate3d(${direction * -106}px, ${direction * 18}px, 0) scale(1.5)`,
    },
  ],
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
  const animations =
    effect.trajectory === "04"
      ? fireballCast(pieces, direction)
      : effect.trajectory === "07"
        ? radialCharge(pieces, direction)
        : effect.trajectory === "10"
          ? skyfallCharge(pieces, direction)
          : genericCast(layer, pieces, effect, direction);
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
  const signature =
    effect.trajectory === "04" ||
    effect.trajectory === "07" ||
    effect.trajectory === "10";
  const effectAnimations = hit
    ? effect.trajectory === "04"
      ? fireballImpact(pieces, direction)
      : effect.trajectory === "07"
        ? radialImpact(pieces, direction)
        : effect.trajectory === "10"
          ? skyfallImpact(pieces, direction)
          : []
    : signature
      ? missDissolve(pieces, direction, effect.trajectory)
      : [];
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

function genericCast(
  layer: HTMLElement,
  pieces: readonly HTMLElement[],
  effect: BattleEffect,
  direction: 1 | -1,
): Animation[] {
  const animations = [
    layer.animate(trajectories[effect.trajectory](direction), {
      duration: 620,
      easing: "steps(10, end)",
      fill: "both",
    }),
  ];
  for (const [index, piece] of pieces.entries()) {
    animations.push(
      piece.animate(
        [
          { opacity: 0, transform: "translate3d(0, 0, 0) scale(.3)" },
          {
            opacity: 0.95,
            transform: `translate3d(${(index - 5.5) * 8}px, ${(index % 2 ? -1 : 1) * 20}px, 0) scale(1)`,
          },
          {
            opacity: 0,
            transform: `translate3d(${(index - 5.5) * 14}px, ${(index % 2 ? -1 : 1) * 42}px, 0) scale(.5)`,
          },
        ],
        {
          duration: 420,
          delay: 80 + index * 16,
          easing: "steps(6, end)",
          fill: "both",
        },
      ),
    );
  }
  return animations;
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

function missDissolve(
  pieces: readonly HTMLElement[],
  direction: 1 | -1,
  trajectory: TrajectoryKey,
): Animation[] {
  const { targetX, targetY } = attackCoordinates(direction);
  const vertical = trajectory === "10";
  return pieces.map((piece, index) =>
    piece.animate(
      [
        {
          opacity: index < 3 ? 0.85 : 0.45,
          transform: `translate3d(${targetX}px, ${vertical ? -96 + index * 8 : targetY}px, 0) scale(.8)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${vertical ? targetX + (index - 5.5) * 7 : targetX - direction * (42 + index * 4)}px, ${vertical ? targetY - 18 : targetY + direction * (24 + (index % 3) * 8)}px, 0) scale(.25)`,
        },
      ],
      {
        duration: 220,
        delay: index * 10,
        easing: "steps(5, end)",
        fill: "both",
      },
    ),
  );
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
  return Object.hasOwn(trajectories, value);
}
