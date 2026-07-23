import type { MonsterTamerAreaId, MonsterTamerElement } from "../bridge.ts";

export const MONSTER_TAMER_TILE_SIZE = 64;

export type Cell = Readonly<{ x: number; y: number }>;

export type AreaPalette = Readonly<{
  sky: number;
  base: number;
  patch: number;
  path: number;
  wall: number;
  accent: number;
  fog: number;
  element: MonsterTamerElement | null;
}>;

export type DecorationKind =
  | "bloom"
  | "crystal"
  | "fern"
  | "grass"
  | "lava"
  | "reed"
  | "rock"
  | "rune"
  | "tree"
  | "water"
  | "wind";

export type AreaDefinition = Readonly<{
  id: MonsterTamerAreaId;
  name: string;
  seed: number;
  obstacleDensity: number;
  decorationKinds: readonly DecorationKind[];
  palette: AreaPalette;
}>;

export type AreaDecoration = Readonly<{
  cell: Cell;
  kind: DecorationKind;
  blocked: boolean;
  variant: number;
}>;

export type AreaLayout = Readonly<{
  ground: readonly (readonly number[])[];
  blockedCellIds: ReadonlySet<string>;
  decorations: readonly AreaDecoration[];
}>;

export const AREA_DEFINITIONS: Readonly<
  Record<MonsterTamerAreaId, AreaDefinition>
> = {
  camp: {
    id: "camp",
    name: "中心营地",
    seed: 0x1a4b,
    obstacleDensity: 0.08,
    decorationKinds: ["grass", "bloom", "rock", "fern"],
    palette: {
      sky: 0xb9f3ff,
      base: 0x8ddf8a,
      patch: 0x6bcf78,
      path: 0xe8d39a,
      wall: 0x457a57,
      accent: 0xffe45c,
      fog: 0x234659,
      element: null,
    },
  },
  luminous_forest: {
    id: "luminous_forest",
    name: "萤光森林",
    seed: 0x31c7,
    obstacleDensity: 0.2,
    decorationKinds: ["tree", "fern", "bloom", "grass"],
    palette: {
      sky: 0xb6f7de,
      base: 0x51c982,
      patch: 0x2fab6d,
      path: 0x98dc9b,
      wall: 0x176b50,
      accent: 0x9dffdf,
      fog: 0x153f42,
      element: "wood",
    },
  },
  tidal_wetland: {
    id: "tidal_wetland",
    name: "潮汐湿地",
    seed: 0x5ea1,
    obstacleDensity: 0.16,
    decorationKinds: ["water", "reed", "bloom", "rock"],
    palette: {
      sky: 0xb8f1ff,
      base: 0x72d8c8,
      patch: 0x40bfc4,
      path: 0xc8e2a3,
      wall: 0x187f93,
      accent: 0x63eaff,
      fog: 0x164d65,
      element: "water",
    },
  },
  windswept_highlands: {
    id: "windswept_highlands",
    name: "风蚀高原",
    seed: 0x7d35,
    obstacleDensity: 0.14,
    decorationKinds: ["wind", "grass", "rock", "bloom"],
    palette: {
      sky: 0xd8f4ff,
      base: 0xa6d991,
      patch: 0x84c990,
      path: 0xe7dfae,
      wall: 0x637f78,
      accent: 0xeaffff,
      fog: 0x375263,
      element: "wind",
    },
  },
  crystal_cavern: {
    id: "crystal_cavern",
    name: "晶矿洞窟",
    seed: 0x92ef,
    obstacleDensity: 0.19,
    decorationKinds: ["crystal", "rock", "rune", "crystal"],
    palette: {
      sky: 0xe8e0ff,
      base: 0x887ac2,
      patch: 0x6f65ad,
      path: 0xb9a8db,
      wall: 0x4c477f,
      accent: 0x8df4ff,
      fog: 0x29284d,
      element: "lightning",
    },
  },
  molten_basin: {
    id: "molten_basin",
    name: "熔火盆地",
    seed: 0xb419,
    obstacleDensity: 0.18,
    decorationKinds: ["lava", "rock", "rune", "crystal"],
    palette: {
      sky: 0xffd6ac,
      base: 0xb75b4e,
      patch: 0x934641,
      path: 0xe29b63,
      wall: 0x5f3235,
      accent: 0xffca3a,
      fog: 0x49242b,
      element: "fire",
    },
  },
  hidden_cave: {
    id: "hidden_cave",
    name: "隐藏洞穴",
    seed: 0xd264,
    obstacleDensity: 0.23,
    decorationKinds: ["crystal", "rune", "rock", "bloom"],
    palette: {
      sky: 0xc9d8ff,
      base: 0x596d86,
      patch: 0x465a76,
      path: 0x8194a4,
      wall: 0x2d384f,
      accent: 0xb7ffcf,
      fog: 0x1b273b,
      element: "lightning",
    },
  },
  guardian_lair: {
    id: "guardian_lair",
    name: "最终守护者巢穴",
    seed: 0xf0a7,
    obstacleDensity: 0.12,
    decorationKinds: ["rune", "crystal", "wind", "bloom"],
    palette: {
      sky: 0xf2e6ff,
      base: 0x7568b6,
      patch: 0x6355a3,
      path: 0xb6a8e5,
      wall: 0x443875,
      accent: 0xffdf70,
      fog: 0x292243,
      element: null,
    },
  },
};

export function getAreaDefinition(id: MonsterTamerAreaId): AreaDefinition {
  return AREA_DEFINITIONS[id];
}

export function getAreaTileOffset(id: MonsterTamerAreaId): number {
  return Object.keys(AREA_DEFINITIONS).indexOf(id) * 4;
}

export function generateAreaLayout({
  definition,
  width,
  height,
  walkableCellIds,
}: {
  definition: AreaDefinition;
  width: number;
  height: number;
  walkableCellIds: readonly string[];
}): AreaLayout {
  const blocked = new Set<string>();
  const walkable = new Set(walkableCellIds);
  const decorations: AreaDecoration[] = [];
  const ground: number[][] = [];
  const tileOffset = getAreaTileOffset(definition.id);

  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];

    for (let x = 0; x < width; x += 1) {
      const noise = cellNoise(definition.seed, x, y);
      const shouldBlock = !walkable.has(cellKey({ x, y }));
      const patch = noise > 0.72 ? 1 : noise < 0.12 ? 2 : 0;

      row.push(tileOffset + patch);

      if (shouldBlock) {
        blocked.add(cellKey({ x, y }));
      }

      const decorationChance = shouldBlock ? 0.7 : 0.075;
      if (noise2(definition.seed, x, y) < decorationChance) {
        decorations.push({
          cell: { x, y },
          kind:
            definition.decorationKinds[
              Math.floor(noise * definition.decorationKinds.length)
            ] ?? "grass",
          blocked: shouldBlock,
          variant: Math.floor(noise * 4),
        });
      }
    }

    ground.push(row);
  }

  return {
    ground,
    blockedCellIds: blocked,
    decorations: decorations.filter(
      ({ cell, blocked: decorationBlocked }) =>
        decorationBlocked === blocked.has(cellKey(cell)),
    ),
  };
}

export function cellKey(cell: Cell): string {
  return `${cell.x}:${cell.y}`;
}

export function cellCenter(cell: Cell): Readonly<{ x: number; y: number }> {
  return {
    x: cell.x * MONSTER_TAMER_TILE_SIZE + MONSTER_TAMER_TILE_SIZE / 2,
    y: cell.y * MONSTER_TAMER_TILE_SIZE + MONSTER_TAMER_TILE_SIZE / 2,
  };
}

export function sameCell(left: Cell, right: Cell): boolean {
  return left.x === right.x && left.y === right.y;
}

export function manhattan(left: Cell, right: Cell): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function cellNoise(seed: number, x: number, y: number): number {
  let value = Math.imul(x + 17, 0x45d9f3b) ^ Math.imul(y + 37, 0x119de1f3);
  value = Math.imul(value ^ seed, 0x27d4eb2d);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function noise2(seed: number, x: number, y: number): number {
  return cellNoise(seed ^ 0x9e3779b9, x + 101, y + 211);
}
