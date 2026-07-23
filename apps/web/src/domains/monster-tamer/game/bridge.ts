import type {
  MonsterAbility,
  MonsterBattle,
  MonsterCheckpointCommand,
  MonsterEncounter,
  MonsterInventoryItem,
  MonsterPartyMember,
  MonsterRegionId,
  MonsterTamerBootstrap,
  MonsterWorldNode,
  MonsterWorldRegion,
} from "../types.ts";

export const MONSTER_TAMER_AREA_IDS = [
  "camp",
  "luminous_forest",
  "tidal_wetland",
  "windswept_highlands",
  "crystal_cavern",
  "molten_basin",
  "hidden_cave",
  "guardian_lair",
] as const satisfies readonly MonsterRegionId[];

export type MonsterTamerAreaId = MonsterRegionId;
export type MonsterTamerElement = MonsterInventoryItem["element"];
export type MonsterTamerEnemyKind = MonsterEncounter["kind"];
export type MonsterTamerPanel = "team" | "backpack" | "map" | "abilities";
export type MonsterTamerGameSnapshot = MonsterTamerBootstrap;

export type MonsterTamerPartyView = {
  templateId: string;
  name: string;
  imageThumbnailPath: string;
  hp: number;
  maxHp: number;
};

export type MonsterTamerGameViewState = {
  areaId: MonsterTamerAreaId;
  areaName: string;
  party: readonly MonsterTamerPartyView[];
  abilities: readonly MonsterAbility[];
  revealedCellIds: readonly string[];
  traversedCellIds: readonly string[];
  battle?: MonsterBattle;
  notice?: string;
};

export type MonsterTamerBattleCommand =
  | {
      kind: "start";
      encounterId: string;
      sourceNodeId: string | null;
    }
  | {
      kind: "use_skill";
      skillSlot: 1 | 2 | 3;
    };

export type MonsterTamerGameEvent =
  | { type: "ready" }
  | { type: "close" }
  | { type: "open-panel"; panel: MonsterTamerPanel }
  | { type: "view-state"; state: MonsterTamerGameViewState }
  | {
      type: "checkpoint";
      commandId: string;
      command: MonsterCheckpointCommand;
      revealedCellIds: readonly string[];
      traversedCellIds: readonly string[];
    }
  | {
      type: "battle";
      commandId: string;
      command: MonsterTamerBattleCommand;
    };

export type MonsterTamerCommandResult = {
  ok: boolean;
  snapshot?: MonsterTamerGameSnapshot;
  errorCode?: string;
  message?: string;
};

export type MonsterTamerMountOptions = {
  container: HTMLElement;
  snapshot: MonsterTamerGameSnapshot;
  onEvent(event: MonsterTamerGameEvent): void;
};

export type MonsterTamerGameHandle = {
  setPaused(paused: boolean): void;
  replaceSnapshot(snapshot: MonsterTamerGameSnapshot): void;
  resolveCommand(commandId: string, result: MonsterTamerCommandResult): void;
  destroy(): void;
};

export type NormalizedPartyMember = {
  state: MonsterPartyMember;
  template: MonsterInventoryItem;
};

export type NormalizedMonsterTamerSnapshot = {
  raw: MonsterTamerGameSnapshot;
  areaId: MonsterTamerAreaId;
  region: MonsterWorldRegion;
  inventory: readonly MonsterInventoryItem[];
  party: readonly NormalizedPartyMember[];
  abilities: ReadonlySet<MonsterAbility>;
  revealedCellIds: ReadonlySet<string>;
  completedNodeIds: ReadonlySet<string>;
  defeatedEliteIds: ReadonlySet<string>;
  defeatedBossIds: ReadonlySet<string>;
  unlockedRegions: ReadonlySet<MonsterRegionId>;
  nodes: readonly MonsterWorldNode[];
  encounters: readonly MonsterEncounter[];
  activeBattle: MonsterBattle | null;
  resumePosition: Readonly<{ x: number; y: number }>;
};

export function normalizeMonsterTamerSnapshot(
  snapshot: MonsterTamerGameSnapshot,
): NormalizedMonsterTamerSnapshot {
  const areaId = snapshot.progress.current_region;
  const completedNodeIds = new Set(snapshot.progress.completed_node_ids);
  const refreshableClaimIds = new Set(
    snapshot.progress.current_refreshable_claim_ids,
  );
  const defeatedEliteIds = new Set(snapshot.progress.defeated_elite_ids);
  const defeatedBossIds = new Set(snapshot.progress.defeated_boss_ids);
  const region =
    snapshot.world.regions.find((candidate) => candidate.id === areaId) ??
    snapshot.world.regions.find((candidate) => candidate.id === "camp");

  if (!region) {
    throw new Error(
      "Monster Tamer bootstrap does not contain the camp region.",
    );
  }

  const inventoryById = new Map(
    snapshot.inventory.map((template) => [template.template_id, template]),
  );

  return {
    raw: snapshot,
    areaId,
    region,
    inventory: snapshot.inventory,
    party: snapshot.progress.party.flatMap((state) => {
      const template = inventoryById.get(state.template_id);
      return template ? [{ state, template }] : [];
    }),
    abilities: new Set(snapshot.progress.abilities),
    revealedCellIds: new Set(snapshot.progress.revealed_cells[areaId] ?? []),
    completedNodeIds,
    defeatedEliteIds,
    defeatedBossIds,
    unlockedRegions: new Set([
      "camp" as const,
      ...snapshot.progress.unlocked_regions,
    ]),
    nodes: snapshot.world.nodes
      .filter((node) => node.region_id === areaId)
      .map((node) => ({
        ...node,
        completed: node.completed || completedNodeIds.has(node.id),
        claimed: node.claimed || refreshableClaimIds.has(node.id),
      })),
    encounters: snapshot.world.encounters
      .filter((encounter) => encounter.region_id === areaId)
      .map((encounter) => {
        const claimed =
          encounter.claimed ||
          (encounter.kind === "elite" && defeatedEliteIds.has(encounter.id)) ||
          (encounter.kind === "normal" &&
            refreshableClaimIds.has(encounter.id));
        return {
          ...encounter,
          available: encounter.available && !claimed,
          claimed,
        };
      }),
    activeBattle: snapshot.active_battle,
    resumePosition: snapshot.progress.resume_position,
  };
}

export function createCommandId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `monster-command-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export type {
  MonsterAbility,
  MonsterBattle,
  MonsterCheckpointCommand,
  MonsterEncounter,
  MonsterInventoryItem,
  MonsterPartyMember,
  MonsterRegionId,
  MonsterWorldNode,
  MonsterWorldRegion,
};
