import type Phaser from "phaser";

import type {
  MonsterTamerCommandResult,
  MonsterTamerGameEvent,
  MonsterTamerGameSnapshot,
  MonsterTamerGameViewState,
  NormalizedMonsterTamerSnapshot,
} from "../bridge.ts";
import { normalizeMonsterTamerSnapshot } from "../bridge.ts";

export const MONSTER_TAMER_RUNTIME_KEY = "monster-tamer-runtime";

type SnapshotListener = (
  snapshot: NormalizedMonsterTamerSnapshot,
  previous: NormalizedMonsterTamerSnapshot,
) => void;

type CommandListener = (
  commandId: string,
  result: MonsterTamerCommandResult,
) => void;

type PauseListener = (paused: boolean) => void;

export class GameRuntime {
  private normalizedSnapshot: NormalizedMonsterTamerSnapshot;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly commandListeners = new Set<CommandListener>();
  private readonly pauseListeners = new Set<PauseListener>();
  private game: Phaser.Game | null = null;
  private paused = false;
  private destroyed = false;
  private readyEmitted = false;

  public constructor(
    snapshot: MonsterTamerGameSnapshot,
    private readonly onEvent: (event: MonsterTamerGameEvent) => void,
  ) {
    this.normalizedSnapshot = normalizeMonsterTamerSnapshot(snapshot);
  }

  public get snapshot(): NormalizedMonsterTamerSnapshot {
    return this.normalizedSnapshot;
  }

  public attachGame(game: Phaser.Game): void {
    this.game = game;
    game.registry.set(MONSTER_TAMER_RUNTIME_KEY, this);
    if (this.paused) {
      game.input.enabled = false;
      game.loop.sleep();
    }
  }

  public emitReady(): void {
    if (this.readyEmitted) return;
    this.readyEmitted = true;
    this.emit({ type: "ready" });
  }

  public emit(event: MonsterTamerGameEvent): void {
    if (this.destroyed) return;
    this.onEvent(event);
  }

  public emitViewState(
    revealedCellIds: ReadonlySet<string>,
    traversedCellIds: readonly string[],
    notice?: string,
  ): void {
    const snapshot = this.normalizedSnapshot;
    const state: MonsterTamerGameViewState = {
      areaId: snapshot.areaId,
      areaName: snapshot.region.name,
      party: snapshot.party.map(({ state: member, template }) => ({
        templateId: template.template_id,
        name: template.name,
        imageThumbnailPath: template.image_thumbnail_path,
        hp: member.current_hp,
        maxHp: member.max_hp,
      })),
      abilities: [...snapshot.abilities],
      revealedCellIds: [...revealedCellIds],
      traversedCellIds: [...traversedCellIds],
      ...(snapshot.activeBattle ? { battle: snapshot.activeBattle } : {}),
      ...(notice ? { notice } : {}),
    };
    this.emit({ type: "view-state", state });
  }

  public replaceSnapshot(snapshot: MonsterTamerGameSnapshot): void {
    if (this.destroyed) return;
    const previous = this.normalizedSnapshot;
    this.normalizedSnapshot = normalizeMonsterTamerSnapshot(snapshot);
    for (const listener of [...this.snapshotListeners]) {
      listener(this.normalizedSnapshot, previous);
    }
  }

  public resolveCommand(
    commandId: string,
    result: MonsterTamerCommandResult,
  ): void {
    if (this.destroyed) return;
    if (result.snapshot) this.replaceSnapshot(result.snapshot);
    for (const listener of [...this.commandListeners]) {
      listener(commandId, result);
    }
  }

  public setPaused(paused: boolean): void {
    if (this.destroyed || this.paused === paused) return;
    this.paused = paused;
    for (const listener of [...this.pauseListeners]) listener(paused);
    if (!this.game) return;
    this.game.input.enabled = !paused;
    if (paused) {
      this.game.loop.sleep();
    } else {
      this.game.loop.wake();
    }
  }

  public onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  public onCommandResult(listener: CommandListener): () => void {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  public onPause(listener: PauseListener): () => void {
    this.pauseListeners.add(listener);
    return () => {
      this.pauseListeners.delete(listener);
    };
  }

  public destroy(): void {
    this.destroyed = true;
    this.snapshotListeners.clear();
    this.commandListeners.clear();
    this.pauseListeners.clear();
    this.game = null;
  }
}

export function runtimeFromScene(scene: Phaser.Scene): GameRuntime {
  const runtime = scene.registry.get(MONSTER_TAMER_RUNTIME_KEY) as
    | GameRuntime
    | undefined;
  if (!runtime) {
    throw new Error("Monster Tamer runtime is not registered.");
  }
  return runtime;
}
