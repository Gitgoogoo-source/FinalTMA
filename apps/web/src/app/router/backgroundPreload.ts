import type { RouteOutput } from "@pokepets/api-contracts/app";

import {
  prefetchApiQuery,
  queryClient,
  routeQueryKey,
} from "../../platform/query/index.ts";

const MONSTER_TAMER_ROOT = "/monster-tamer/";
const MONSTER_TAMER_RESOURCES = [
  `${MONSTER_TAMER_ROOT}?embedded=1`,
  `${MONSTER_TAMER_ROOT}styles.css`,
  `${MONSTER_TAMER_ROOT}vendor/phaser-3.60.0.min.js`,
  `${MONSTER_TAMER_ROOT}src/main.js`,
  `${MONSTER_TAMER_ROOT}src/bridge.js`,
  `${MONSTER_TAMER_ROOT}src/lib/phaser.js`,
  `${MONSTER_TAMER_ROOT}src/scenes/pet-home-scene.js`,
  `${MONSTER_TAMER_ROOT}src/systems/grid-pathfinder.js`,
  `${MONSTER_TAMER_ROOT}src/assets/player-character.js`,
  `${MONSTER_TAMER_ROOT}src/assets/tiny-swords-world.js`,
  `${MONSTER_TAMER_ROOT}assets/data/main_1.json`,
  `${MONSTER_TAMER_ROOT}assets/images/axulart/character/custom.png`,
  `${MONSTER_TAMER_ROOT}assets/images/tiny-swords/tiny-swords-terrain-extruded.png`,
  ...[
    "archery",
    "barracks",
    "castle",
    "house-1",
    "house-2",
    "house-3",
    "monastery",
    "tower",
  ].map(
    (name) =>
      `${MONSTER_TAMER_ROOT}assets/images/tiny-swords/buildings/${name}.png`,
  ),
  ...[
    "bush-1",
    "bush-2",
    "bush-3",
    "bush-4",
    "rock-1",
    "rock-2",
    "rock-3",
    "rock-4",
    "shadow",
    "stump-1",
    "stump-2",
    "stump-3",
    "stump-4",
    "tree-1",
    "tree-2",
    "tree-3",
    "tree-4",
    "water-foam",
    "water-rock-1",
    "water-rock-2",
    "water-rock-3",
    "water-rock-4",
  ].map(
    (name) =>
      `${MONSTER_TAMER_ROOT}assets/images/tiny-swords/environment/${name}.png`,
  ),
] as const;

export async function preloadMonsterTamer(): Promise<void> {
  await Promise.allSettled([
    warmResources(MONSTER_TAMER_RESOURCES),
    prefetchApiQuery("inventory.list"),
  ]);
  const inventory = queryClient.getQueryData<RouteOutput<"inventory.list">>(
    routeQueryKey("inventory.list"),
  );
  if (!inventory) return;
  await warmResources(
    inventory.items
      .filter((item) => item.available > 0)
      .map((item) => item.image_thumbnail_path),
  );
}

async function warmResources(paths: readonly string[]): Promise<void> {
  await Promise.allSettled(
    [...new Set(paths)].map(async (path) => {
      const response = await fetch(path, {
        cache: "force-cache",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`PRELOAD_FAILED:${path}`);
    }),
  );
}
