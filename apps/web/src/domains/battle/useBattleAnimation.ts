import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  BattleActionEventDto,
  BattleOpponentTeamDto,
  BattleRoomSnapshotDto,
  BattleSelfTeamDto,
} from "@pokepets/api-contracts/app";

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
type TeamSlot = 1 | 2 | 3;

type PresentationState = {
  selfTeam: BattleSelfTeamDto;
  opponentTeam: BattleOpponentTeamDto;
  feedback: BattleActionEventDto | null;
};

type QueueItem = {
  key: string;
  local: BattleLocalActionIntent | null;
  event: BattleActionEventDto | null;
  castPlayed: boolean;
};

export type BattleLocalActionIntent = {
  key: string;
  roomId: string;
  roundNo: number;
  actionOrdinal: 1 | 2;
  kind: "attack" | "replace_attack";
  effectKey: string;
  teamSlot: TeamSlot | null;
};

export function battlePresentationActionKey(
  roomId: string,
  roundNo: number,
  actionOrdinal: number,
): string {
  return `${roomId}:${roundNo}:${actionOrdinal}`;
}

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
  snapshot,
  events,
  localAction,
  cancelledLocalActionKey,
  resetVersion,
  onBusyChange,
}: {
  arenaRef: RefObject<HTMLDivElement | null>;
  snapshot: BattleRoomSnapshotDto;
  events: readonly BattleActionEventDto[];
  localAction: BattleLocalActionIntent | null;
  cancelledLocalActionKey: string | null;
  resetVersion: number;
  onBusyChange(busy: boolean): void;
}): PresentationState & { busy: boolean } {
  const [presentation, setPresentation] = useState<PresentationState>(() =>
    presentationFrom(snapshot),
  );
  const [busy, setBusy] = useState(false);
  const snapshotRef = useRef(snapshot);
  const queue = useRef<QueueItem[]>([]);
  const seenEvents = useRef(new Set<string>());
  const seenLocalActions = useRef(new Set<string>());
  const running = useRef(false);
  const run = useRef(0);
  const room = useRef(snapshot.room_id);
  const reset = useRef(resetVersion);
  const busyRef = useRef(false);
  const onBusyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  const publishBusy = useCallback((next: boolean) => {
    if (busyRef.current === next) return;
    busyRef.current = next;
    setBusy(next);
    onBusyChangeRef.current(next);
  }, []);

  const reconcile = useCallback(() => {
    setPresentation((current) => ({
      ...presentationFrom(snapshotRef.current),
      feedback: current.feedback,
    }));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const startedRun = run.current;
    try {
      while (run.current === startedRun) {
        const item = queue.current[0];
        const arena = arenaRef.current;
        if (!item || !arena || document.visibilityState !== "visible") break;
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const local = item.local;
        if (local && !item.castPlayed) {
          if (local.kind === "replace_attack" && local.teamSlot !== null) {
            applySwitch(setPresentation, "self", local.teamSlot);
            await nextPaint();
            if (!reduced) {
              const actor = actorElement(arena, "self");
              if (actor) await playSwitchIn(actor);
            }
          }
          const effect = parseEffectKey(local.effectKey);
          if (effect && !reduced)
            await playAttackCast(arena, actorElement(arena, "self"), effect);
          item.castPlayed = true;
          if (run.current !== startedRun) break;
        }
        if (!item.event) break;
        await playAuthoritativeEvent(
          arena,
          item,
          reduced,
          setPresentation,
          () => run.current !== startedRun,
        );
        if (run.current !== startedRun) break;
        if (queue.current[0] === item) queue.current.shift();
      }
    } finally {
      if (run.current === startedRun) {
        running.current = false;
        if (queue.current.length === 0) {
          reconcile();
          publishBusy(false);
        }
      }
    }
  }, [arenaRef, publishBusy, reconcile]);
  useEffect(() => {
    if (room.current === snapshot.room_id && reset.current === resetVersion)
      return;
    room.current = snapshot.room_id;
    reset.current = resetVersion;
    run.current += 1;
    running.current = false;
    queue.current = [];
    seenEvents.current.clear();
    seenLocalActions.current.clear();
    cancelAnimation(arenaRef.current);
    setPresentation(presentationFrom(snapshot));
    publishBusy(false);
  }, [arenaRef, publishBusy, resetVersion, snapshot]);

  useEffect(() => {
    if (
      !localAction ||
      localAction.roomId !== snapshot.room_id ||
      seenLocalActions.current.has(localAction.key)
    )
      return;
    seenLocalActions.current.add(localAction.key);
    const existing = queue.current.find((item) => item.key === localAction.key);
    if (existing) existing.local = localAction;
    else
      queue.current.push({
        key: localAction.key,
        local: localAction,
        event: null,
        castPlayed: false,
      });
    publishBusy(true);
    void drain();
  }, [drain, localAction, publishBusy, snapshot.room_id]);

  useEffect(() => {
    let changed = false;
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
      if (seenEvents.current.has(event.event_id)) continue;
      seenEvents.current.add(event.event_id);
      const key = battlePresentationActionKey(
        snapshot.room_id,
        event.round_no,
        event.action_ordinal,
      );
      const existing = queue.current.find((item) => item.key === key);
      if (existing) {
        existing.event = event;
        if (existing.local && !localActionMatchesEvent(existing.local, event))
          existing.local = null;
      } else
        queue.current.push({
          key,
          local: null,
          event,
          castPlayed: false,
        });
      changed = true;
    }
    if (!changed) return;
    publishBusy(true);
    void drain();
  }, [drain, events, publishBusy, snapshot.room_id]);

  useEffect(() => {
    if (!cancelledLocalActionKey) return;
    const index = queue.current.findIndex(
      (item) => item.key === cancelledLocalActionKey && item.local,
    );
    if (index < 0) return;
    const item = queue.current[index]!;
    seenLocalActions.current.delete(cancelledLocalActionKey);
    const cancellingHead = index === 0;
    if (cancellingHead) {
      run.current += 1;
      running.current = false;
    }
    if (item.event) {
      item.local = null;
      item.castPlayed = false;
    } else queue.current.splice(index, 1);
    if (cancellingHead) {
      cancelAnimation(arenaRef.current);
      reconcile();
    }
    if (queue.current.length === 0) publishBusy(false);
    else void drain();
  }, [arenaRef, cancelledLocalActionKey, drain, publishBusy, reconcile]);

  useEffect(() => {
    if (
      queue.current.length > 0 ||
      running.current ||
      events.some((event) => !seenEvents.current.has(event.event_id))
    )
      return;
    reconcile();
  }, [events, reconcile, snapshot.state_version]);

  useEffect(() => {
    const mountedArena = arenaRef.current;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      run.current += 1;
      running.current = false;
      queue.current = [];
      cancelAnimation(arenaRef.current);
      reconcile();
      publishBusy(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      run.current += 1;
      running.current = false;
      queue.current = [];
      cancelAnimation(mountedArena);
      publishBusy(false);
    };
  }, [arenaRef, publishBusy, reconcile]);

  return { ...presentation, busy };
}

async function playAuthoritativeEvent(
  arena: HTMLDivElement,
  item: QueueItem,
  reduced: boolean,
  setPresentation: Dispatch<SetStateAction<PresentationState>>,
  cancelled: () => boolean,
): Promise<void> {
  const event = item.event;
  if (!event) return;
  const localCovered = Boolean(item.local && item.castPlayed);
  for (const action of event.actions) {
    if (cancelled()) return;
    if (action.kind === "switch") {
      const covered =
        localCovered &&
        action.actor === "self" &&
        item.local?.kind === "replace_attack";
      if (!covered && !reduced) {
        const leaving = actorElement(arena, action.actor);
        if (leaving) await playSwitchOut(leaving);
      }
      if (!covered) {
        applySwitch(setPresentation, action.actor, action.switch_to.slot);
        await nextPaint();
        if (!reduced) {
          const entering = actorElement(arena, action.actor);
          if (entering) await playSwitchIn(entering);
        }
      }
      setPresentation((current) => ({ ...current, feedback: event }));
      continue;
    }
    const covered = localCovered && action.actor === "self";
    const effect = parseEffectKey(action.effect_key);
    if (!covered && effect && !reduced)
      await playAttackCast(arena, actorElement(arena, action.actor), effect);
    setPresentation((current) => ({ ...current, feedback: event }));
    if (!reduced && action.hit) {
      const target = actorElement(
        arena,
        action.actor === "self" ? "opponent" : "self",
      );
      if (target) await playAttackImpact(target, action.knockout);
    }
  }
  if (cancelled()) return;
  applyHpResult(setPresentation, event);
  await nextPaint();
}

function presentationFrom(snapshot: BattleRoomSnapshotDto): PresentationState {
  return {
    selfTeam: snapshot.self_team.map((member) => ({ ...member })),
    opponentTeam: snapshot.opponent_team.map((member) => ({
      ...member,
    })) as BattleOpponentTeamDto,
    feedback: null,
  };
}

function localActionMatchesEvent(
  local: BattleLocalActionIntent,
  event: BattleActionEventDto,
): boolean {
  if (event.actor !== "self") return false;
  if (local.kind === "attack") {
    const [attack] = event.actions;
    return (
      event.actions.length === 1 &&
      attack?.actor === "self" &&
      attack.kind === "attack" &&
      attack.effect_key === local.effectKey
    );
  }
  const [replacement, attack] = event.actions;
  return (
    event.actions.length === 2 &&
    replacement?.actor === "self" &&
    replacement.kind === "switch" &&
    replacement.switch_to.slot === local.teamSlot &&
    attack?.actor === "self" &&
    attack.kind === "attack" &&
    attack.effect_key === local.effectKey
  );
}

function applySwitch(
  setPresentation: Dispatch<SetStateAction<PresentationState>>,
  actor: "self" | "opponent",
  slot: TeamSlot,
): void {
  setPresentation((current) =>
    actor === "self"
      ? {
          ...current,
          selfTeam: current.selfTeam.map((member) => ({
            ...member,
            active: member.slot === slot && member.alive,
          })) as BattleSelfTeamDto,
        }
      : {
          ...current,
          opponentTeam: current.opponentTeam.map((member) => ({
            ...member,
            active: member.slot === slot && member.alive,
          })) as BattleOpponentTeamDto,
        },
  );
}

function applyHpResult(
  setPresentation: Dispatch<SetStateAction<PresentationState>>,
  event: BattleActionEventDto,
): void {
  const selfHp = new Map(event.self_hp.map((member) => [member.slot, member]));
  const opponentHp = new Map(
    event.opponent_hp.map((member) => [member.slot, member]),
  );
  setPresentation((current) => ({
    feedback: event,
    selfTeam: current.selfTeam.map((member) => {
      const hp = selfHp.get(member.slot);
      return hp
        ? {
            ...member,
            current_hp: hp.current_hp,
            max_hp: hp.max_hp,
            alive: hp.alive,
            active: member.active && hp.alive,
          }
        : member;
    }) as BattleSelfTeamDto,
    opponentTeam: current.opponentTeam.map((member) => {
      const hp = opponentHp.get(member.slot);
      return hp
        ? {
            ...member,
            hp_percent: hp.hp_percent,
            alive: hp.alive,
            active: member.active && hp.alive,
          }
        : member;
    }) as BattleOpponentTeamDto,
  }));
}

async function playAttackCast(
  arena: HTMLDivElement,
  actor: HTMLElement | null,
  effect: { element: EffectElement; trajectory: TrajectoryKey },
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
  const particleAnimations = [...layer.querySelectorAll<HTMLElement>("i")].map(
    (particle, index) =>
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
        { duration: 440, delay: 90 + index * 18, easing: "ease-out" },
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
  await Promise.all(particleAnimations.map(finished));
}

async function playAttackImpact(
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
      { duration: 300, easing: "ease-out" },
    ),
  );
  if (knockout)
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

function playSwitchOut(actor: HTMLElement): Promise<void> {
  return finished(
    actor.animate(
      [
        { opacity: 1, transform: "translateX(0) scale(1)" },
        { opacity: 0.2, transform: "translateX(20px) scale(.9)" },
      ],
      { duration: 220, easing: "ease-in" },
    ),
  );
}

function playSwitchIn(actor: HTMLElement): Promise<void> {
  return finished(
    actor.animate(
      [
        { opacity: 0.2, transform: "translateX(-20px) scale(.9)" },
        { opacity: 1, transform: "translateX(0) scale(1)" },
      ],
      { duration: 260, easing: "ease-out" },
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

function cancelAnimation(arena: HTMLDivElement | null): void {
  if (!arena) return;
  arena.getAnimations({ subtree: true }).forEach((animation) => {
    animation.cancel();
  });
  const layer = arena.querySelector<HTMLElement>("[data-battle-effect-layer]");
  if (!layer) return;
  delete layer.dataset.element;
  layer.style.removeProperty("--battle-effect-primary");
  layer.style.removeProperty("--battle-effect-secondary");
  layer.style.removeProperty("--battle-effect-glow");
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function finished(animation: Animation): Promise<void> {
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}
