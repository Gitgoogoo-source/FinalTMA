import { useEffect, useRef, type RefObject } from "react";
import type { BattleResolutionEventDto } from "@pokepets/api-contracts/app";

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

const elementEffects: Record<EffectElement, ElementStyle> = {
  fire: { primary: "#ff6a2b", secondary: "#ffd166", glow: "#ff3d00" },
  grass: { primary: "#38d27a", secondary: "#c7f36b", glow: "#0ca85d" },
  earth: { primary: "#c98a49", secondary: "#f2d28f", glow: "#80542d" },
  lightning: { primary: "#ffe14f", secondary: "#c9f4ff", glow: "#48a9ff" },
  water: { primary: "#42c7ff", secondary: "#b7f2ff", glow: "#1976d2" },
};

const trajectories: Record<TrajectoryKey, (direction: 1 | -1) => Keyframe[]> = {
  "01": (direction) => [
    { transform: `translate3d(0, ${direction * -118}px, 0) scale(.45)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scale(1.1)` },
  ],
  "02": (direction) => [
    { transform: `translate3d(-72px, ${direction * -126}px, 0) scale(.5)` },
    { transform: `translate3d(46px, ${direction * -54}px, 0) scale(.85)` },
    { transform: `translate3d(0, ${direction * 20}px, 0) scale(1.15)` },
  ],
  "03": (direction) => [
    {
      transform: `translate3d(-92px, ${direction * -130}px, 0) rotate(-18deg)`,
    },
    { transform: `translate3d(76px, ${direction * -72}px, 0) rotate(14deg)` },
    { transform: `translate3d(-24px, ${direction * -20}px, 0) rotate(-7deg)` },
    { transform: `translate3d(0, ${direction * 20}px, 0) rotate(0deg)` },
  ],
  "04": (direction) => [
    { transform: `translate3d(0, ${direction * -142}px, 0) scale(.2)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scale(1.25)` },
  ],
  "05": (direction) => [
    {
      transform: `translate3d(0, ${direction * -54}px, 0) scale(.25) rotate(0deg)`,
    },
    {
      transform: `translate3d(0, ${direction * 18}px, 0) scale(1.45) rotate(220deg)`,
    },
  ],
  "06": (direction) => [
    { transform: `translate3d(0, ${direction * 164}px, 0) scale(.55)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scale(1.35)` },
  ],
  "07": (direction) => [
    { transform: `translate3d(0, ${direction * 12}px, 0) scale(.1)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scale(1.8)` },
  ],
  "08": (direction) => [
    { transform: `translate3d(-170px, ${direction * 12}px, 0) scaleX(.15)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scaleX(1.55)` },
    { transform: `translate3d(170px, ${direction * 22}px, 0) scaleX(.35)` },
  ],
  "09": (direction) => [
    {
      transform: `translate3d(0, ${direction * -8}px, 0) rotate(0deg) scale(.4)`,
    },
    {
      transform: `translate3d(0, ${direction * 18}px, 0) rotate(300deg) scale(1.75)`,
    },
  ],
  "10": (direction) => [
    { transform: `translate3d(0, ${direction * 190}px, 0) scale(1.7)` },
    { transform: `translate3d(0, ${direction * 84}px, 0) scale(.55)` },
    { transform: `translate3d(0, ${direction * 18}px, 0) scale(1.5)` },
  ],
};

export function useBattleAnimation({
  arenaRef,
  resolution,
  serverTime,
}: {
  arenaRef: RefObject<HTMLDivElement | null>;
  resolution: BattleResolutionEventDto | null;
  serverTime: string | null;
}): void {
  const played = useRef(new Set<string>());
  const currentResolution = useRef(resolution);

  useEffect(() => {
    currentResolution.current = resolution;
  }, [resolution]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const cancel = () => {
      arena.getAnimations({ subtree: true }).forEach((animation) => {
        animation.cancel();
      });
      const event = currentResolution.current;
      if (event) played.current.add(eventKey(event));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancel();
    };
  }, [arenaRef]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena || !resolution || !serverTime) return;
    const key = eventKey(resolution);
    const offset = Date.parse(serverTime) - Date.now();
    if (
      played.current.has(key) ||
      Date.parse(resolution.reveal_ends_at) <= Date.now() + offset ||
      document.visibilityState !== "visible"
    ) {
      played.current.add(key);
      return;
    }
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled || played.current.has(key)) return;
      played.current.add(key);
      void playResolution(arena, resolution);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      arena.getAnimations({ subtree: true }).forEach((animation) => {
        animation.cancel();
      });
    };
  }, [arenaRef, resolution, serverTime]);
}

async function playResolution(
  arena: HTMLDivElement,
  resolution: BattleResolutionEventDto,
): Promise<void> {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const action of resolution.actions) {
    if (document.visibilityState !== "visible") return;
    const actor = actorElement(arena, action.actor);
    const target = actorElement(
      arena,
      action.actor === "self" ? "opponent" : "self",
    );
    if (action.kind === "attack") {
      const effect = parseEffectKey(action.effect_key);
      if (!effect) {
        console.error("Battle effect key is unavailable", {
          effect_key: action.effect_key,
          event_id: resolution.event_id,
        });
        continue;
      }
      if (reduced) continue;
      await playAttack(arena, actor, target, effect, action.hit);
      if (action.knockout && target) await playKnockout(target);
    } else if (!reduced && actor) {
      await finished(
        actor.animate(
          [
            { opacity: 1, transform: "translateX(0) scale(1)" },
            { opacity: 0.35, transform: "translateX(18px) scale(.92)" },
            { opacity: 1, transform: "translateX(0) scale(1)" },
          ],
          { duration: 360, easing: "ease-out" },
        ),
      );
    }
  }
}

async function playAttack(
  arena: HTMLDivElement,
  actor: HTMLElement | null,
  target: HTMLElement | null,
  effect: { element: EffectElement; trajectory: TrajectoryKey },
  hit: boolean,
): Promise<void> {
  const layer = arena.querySelector<HTMLElement>("[data-battle-effect-layer]");
  if (!layer) return;
  const colors = elementEffects[effect.element];
  layer.dataset.element = effect.element;
  layer.style.setProperty("--battle-effect-primary", colors.primary);
  layer.style.setProperty("--battle-effect-secondary", colors.secondary);
  layer.style.setProperty("--battle-effect-glow", colors.glow);
  const direction: 1 | -1 =
    actor?.closest("[data-battle-actor]")?.getAttribute("data-battle-actor") ===
    "self"
      ? -1
      : 1;
  const travel = layer.animate(trajectories[effect.trajectory](direction), {
    duration: 620,
    easing: "cubic-bezier(.2,.75,.2,1)",
    fill: "both",
  });
  const particles = [...layer.querySelectorAll<HTMLElement>("i")];
  const particleAnimations = particles.map((particle, index) =>
    particle.animate(
      [
        { opacity: 0, transform: "translate3d(0, 0, 0) scale(.3)" },
        {
          opacity: 0.95,
          transform: `translate3d(${(index - 3.5) * 9}px, ${(index % 2 ? -1 : 1) * 22}px, 0) scale(1)`,
        },
        {
          opacity: 0,
          transform: `translate3d(${(index - 3.5) * 17}px, ${(index % 2 ? -1 : 1) * 48}px, 0) scale(.5)`,
        },
      ],
      {
        duration: 440,
        delay: 90 + index * 18,
        easing: "ease-out",
      },
    ),
  );
  if (actor)
    actor.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.06)" },
        { transform: "scale(1)" },
      ],
      { duration: 300, easing: "ease-out" },
    );
  await finished(travel);
  if (hit && target)
    await finished(
      target.animate(
        [
          { transform: "translateX(0)", filter: "brightness(1)" },
          { transform: "translateX(-7px)", filter: "brightness(1.5)" },
          { transform: "translateX(6px)", filter: "brightness(.8)" },
          { transform: "translateX(0)", filter: "brightness(1)" },
        ],
        { duration: 300, easing: "ease-out" },
      ),
    );
  await Promise.all(particleAnimations.map(finished));
}

async function playKnockout(target: HTMLElement): Promise<void> {
  await finished(
    target.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0.45, transform: "translateY(12px) scale(.92)" },
      ],
      { duration: 260, easing: "ease-in", fill: "both" },
    ),
  );
}

function actorElement(
  arena: HTMLDivElement,
  actor: "self" | "opponent",
): HTMLElement | null {
  return arena.querySelector(
    `[data-battle-actor="${actor}"] [data-battle-active-sprite]`,
  );
}

function parseEffectKey(
  key: string,
): { element: EffectElement; trajectory: TrajectoryKey } | null {
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

function isEffectElement(value: string): value is EffectElement {
  return Object.hasOwn(elementEffects, value);
}

function isTrajectory(value: string): value is TrajectoryKey {
  return Object.hasOwn(trajectories, value);
}

function eventKey(event: BattleResolutionEventDto): string {
  return `${event.event_id}:${event.state_version}`;
}

function finished(animation: Animation): Promise<void> {
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}
