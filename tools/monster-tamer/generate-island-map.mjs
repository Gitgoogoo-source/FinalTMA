import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const GAME_ROOT = path.join(ROOT, "apps/web/public/monster-tamer");
const SOURCE_ROOT = path.join(
  ROOT,
  "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25",
);
const SOURCE_MANIFEST_PATH = path.join(SOURCE_ROOT, "SOURCE.json");
const SOURCE_TERMS_PATH = path.join(SOURCE_ROOT, "TERMS.md");
const RUNTIME_ROOT = path.join(GAME_ROOT, "assets/images/tiny-swords");
const RUNTIME_TERRAIN_PATH = path.join(
  RUNTIME_ROOT,
  "tiny-swords-terrain-extruded.png",
);
const PUBLISHED_EVIDENCE_ROOT = path.join(
  GAME_ROOT,
  "assets/licenses/tiny-swords",
);
const MAP_PATH = path.join(GAME_ROOT, "assets/data/main_1.json");

const WIDTH = 50;
const HEIGHT = 50;
const TILE_SIZE = 64;
const SIZE = WIDTH * HEIGHT;
const OUTER_WATER_RING = 2;
const TERRAIN_SOURCE_COLUMNS = 9;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 8;
const ATLAS_MARGIN = 1;
const ATLAS_SPACING = 2;
const ATLAS_CELL_SIZE = TILE_SIZE + ATLAS_SPACING;
const ATLAS_SIZE = ATLAS_COLUMNS * ATLAS_CELL_SIZE;
const WATER_COLOR = Object.freeze([71, 171, 169, 255]);

const TERRAIN_SOURCE_INDICES = Object.freeze([0, 1, 2, 9, 10, 11, 18, 19, 20]);
const TERRAIN_SLOT_BY_SOURCE_INDEX = new Map(
  TERRAIN_SOURCE_INDICES.map((sourceIndex, slot) => [sourceIndex, slot]),
);
const FLAT_PALETTE = Object.freeze({
  topLeft: 0,
  top: 1,
  topRight: 2,
  left: 9,
  center: 10,
  right: 11,
  bottomLeft: 18,
  bottom: 19,
  bottomRight: 20,
});

const RUNTIME_ASSET_COPIES = Object.freeze([
  ["Buildings/Blue Buildings/Archery.png", "buildings/archery.png"],
  ["Buildings/Blue Buildings/Barracks.png", "buildings/barracks.png"],
  ["Buildings/Blue Buildings/Castle.png", "buildings/castle.png"],
  ["Buildings/Blue Buildings/House1.png", "buildings/house-1.png"],
  ["Buildings/Blue Buildings/House2.png", "buildings/house-2.png"],
  ["Buildings/Blue Buildings/House3.png", "buildings/house-3.png"],
  ["Buildings/Blue Buildings/Monastery.png", "buildings/monastery.png"],
  ["Buildings/Blue Buildings/Tower.png", "buildings/tower.png"],
  ["Terrain/Decorations/Bushes/Bushe1.png", "environment/bush-1.png"],
  ["Terrain/Decorations/Bushes/Bushe2.png", "environment/bush-2.png"],
  ["Terrain/Decorations/Bushes/Bushe3.png", "environment/bush-3.png"],
  ["Terrain/Decorations/Bushes/Bushe4.png", "environment/bush-4.png"],
  [
    "Terrain/Decorations/Rocks in the Water/Water Rocks_01.png",
    "environment/water-rock-1.png",
  ],
  [
    "Terrain/Decorations/Rocks in the Water/Water Rocks_02.png",
    "environment/water-rock-2.png",
  ],
  [
    "Terrain/Decorations/Rocks in the Water/Water Rocks_03.png",
    "environment/water-rock-3.png",
  ],
  [
    "Terrain/Decorations/Rocks in the Water/Water Rocks_04.png",
    "environment/water-rock-4.png",
  ],
  ["Terrain/Decorations/Rocks/Rock1.png", "environment/rock-1.png"],
  ["Terrain/Decorations/Rocks/Rock2.png", "environment/rock-2.png"],
  ["Terrain/Decorations/Rocks/Rock3.png", "environment/rock-3.png"],
  ["Terrain/Decorations/Rocks/Rock4.png", "environment/rock-4.png"],
  ["Terrain/Resources/Wood/Trees/Stump 1.png", "environment/stump-1.png"],
  ["Terrain/Resources/Wood/Trees/Stump 2.png", "environment/stump-2.png"],
  ["Terrain/Resources/Wood/Trees/Stump 3.png", "environment/stump-3.png"],
  ["Terrain/Resources/Wood/Trees/Stump 4.png", "environment/stump-4.png"],
  ["Terrain/Resources/Wood/Trees/Tree1.png", "environment/tree-1.png"],
  ["Terrain/Resources/Wood/Trees/Tree2.png", "environment/tree-2.png"],
  ["Terrain/Resources/Wood/Trees/Tree3.png", "environment/tree-3.png"],
  ["Terrain/Resources/Wood/Trees/Tree4.png", "environment/tree-4.png"],
  ["Terrain/Tileset/Shadow.png", "environment/shadow.png"],
  ["Terrain/Tileset/Water Foam.png", "environment/water-foam.png"],
]);

const indexOf = (x, y) => y * WIDTH + x;
const isInside = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const landMask = new Uint8Array(SIZE);
const collision = Array(SIZE).fill(1);
const ground = Array(SIZE).fill(0);

for (let y = 3; y <= 46; y += 1) {
  const normalizedY = (y - 24.5) / 22;
  const halfWidth = Math.floor(
    21.5 * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)),
  );
  const leftNoise = [1, 0, -1, 0, 1, 1, 0][y % 7];
  const rightNoise = [0, 1, 0, -1, 0, 1, 1][y % 7];
  const left = Math.max(3, 24 - halfWidth + leftNoise);
  const right = Math.min(46, 25 + halfWidth + rightNoise);
  for (let x = left; x <= right; x += 1) {
    landMask[indexOf(x, y)] = 1;
  }
}

const hasLand = (x, y) => isInside(x, y) && landMask[indexOf(x, y)] === 1;
const terrainGid = (sourceIndex) => {
  const slot = TERRAIN_SLOT_BY_SOURCE_INDEX.get(sourceIndex);
  if (slot === undefined)
    throw new Error(`Tiny Swords source tile ${sourceIndex} is not curated.`);
  return slot + 1;
};
const tileForMask = (x, y) => {
  const north = hasLand(x, y - 1);
  const south = hasLand(x, y + 1);
  const west = hasLand(x - 1, y);
  const east = hasLand(x + 1, y);
  if (!north && !west) return FLAT_PALETTE.topLeft;
  if (!north && !east) return FLAT_PALETTE.topRight;
  if (!south && !west) return FLAT_PALETTE.bottomLeft;
  if (!south && !east) return FLAT_PALETTE.bottomRight;
  if (!north) return FLAT_PALETTE.top;
  if (!south) return FLAT_PALETTE.bottom;
  if (!west) return FLAT_PALETTE.left;
  if (!east) return FLAT_PALETTE.right;
  return FLAT_PALETTE.center;
};

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (!hasLand(x, y)) continue;
    ground[indexOf(x, y)] = terrainGid(tileForMask(x, y));
    const shoreline =
      !hasLand(x - 1, y) ||
      !hasLand(x + 1, y) ||
      !hasLand(x, y - 1) ||
      !hasLand(x, y + 1);
    collision[indexOf(x, y)] = shoreline ? 1 : 0;
  }
}

const sceneryDefinitions = [
  {
    asset: "castle",
    kind: "building",
    tileX: 21,
    tileY: 12,
    footprint: [5, 4],
  },
  {
    asset: "barracks",
    kind: "building",
    tileX: 14,
    tileY: 15,
    footprint: [3, 4],
  },
  {
    asset: "archery",
    kind: "building",
    tileX: 30,
    tileY: 15,
    footprint: [3, 4],
  },
  {
    asset: "tower",
    kind: "building",
    tileX: 9,
    tileY: 27,
    footprint: [2, 4],
  },
  {
    asset: "monastery",
    kind: "building",
    tileX: 14,
    tileY: 38,
    footprint: [3, 5],
  },
  {
    asset: "house-1",
    kind: "building",
    tileX: 35,
    tileY: 24,
    footprint: [2, 3],
  },
  {
    asset: "house-2",
    kind: "building",
    tileX: 39,
    tileY: 28,
    footprint: [2, 3],
  },
  {
    asset: "house-3",
    kind: "building",
    tileX: 34,
    tileY: 33,
    footprint: [2, 3],
  },
  {
    asset: "house-1",
    kind: "building",
    tileX: 39,
    tileY: 36,
    footprint: [2, 3],
  },
  {
    asset: "tower",
    kind: "building",
    tileX: 26,
    tileY: 43,
    footprint: [2, 4],
  },
  ...[
    [11, 11],
    [16, 8],
    [33, 10],
    [38, 14],
    [8, 20],
    [10, 35],
    [18, 42],
    [31, 42],
    [42, 22],
    [42, 33],
    [21, 7],
    [29, 7],
    [6, 27],
    [44, 27],
  ].map(([tileX, tileY], index) => ({
    asset: `tree-${(index % 4) + 1}`,
    kind: "tree",
    tileX,
    tileY,
    footprint: [1, 1],
  })),
  ...[
    [12, 19],
    [18, 18],
    [30, 19],
    [25, 39],
    [29, 35],
    [19, 37],
  ].map(([tileX, tileY], index) => ({
    asset: `stump-${(index % 4) + 1}`,
    kind: "stump",
    tileX,
    tileY,
    footprint: [1, 1],
  })),
  ...[
    [13, 28],
    [17, 31],
    [22, 20],
    [27, 18],
    [29, 29],
    [32, 37],
    [37, 18],
    [40, 32],
    [21, 41],
    [11, 32],
  ].map(([tileX, tileY], index) => ({
    asset: `rock-${(index % 4) + 1}`,
    kind: "rock",
    tileX,
    tileY,
    footprint: [1, 1],
  })),
  ...[
    [15, 25],
    [18, 27],
    [21, 30],
    [25, 23],
    [27, 32],
    [31, 25],
    [34, 18],
    [36, 38],
  ].map(([tileX, tileY], index) => ({
    asset: `bush-${(index % 4) + 1}`,
    kind: "bush",
    tileX,
    tileY,
    footprint: [0, 0],
  })),
];

for (const definition of sceneryDefinitions) {
  const [width, height] = definition.footprint;
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      const x = definition.tileX + offsetX - Math.floor(width / 2);
      const y = definition.tileY - offsetY;
      if (!hasLand(x, y))
        throw new Error(
          `${definition.asset} footprint leaves the island at (${x}, ${y}).`,
        );
      collision[indexOf(x, y)] = 1;
    }
  }
}

const sceneryObjects = sceneryDefinitions.map((definition, index) => ({
  id: index + 1,
  name: definition.asset,
  type: definition.kind,
  x: (definition.tileX + 0.5) * TILE_SIZE,
  y: (definition.tileY + 1) * TILE_SIZE,
  point: true,
  rotation: 0,
  visible: true,
}));
const waterDefinitions = [
  ["water-rock-1", 8, 8],
  ["water-rock-2", 41, 8],
  ["water-rock-3", 2, 24],
  ["water-rock-4", 47, 18],
  ["water-rock-2", 8, 42],
  ["water-rock-1", 42, 42],
  ["water-foam", 18, 2],
  ["water-foam", 32, 2],
  ["water-foam", 2, 31],
  ["water-foam", 47, 31],
  ["water-foam", 20, 47],
  ["water-foam", 33, 47],
];
const waterSceneryObjects = waterDefinitions.map(
  ([asset, tileX, tileY], index) => {
    if (
      tileX < OUTER_WATER_RING ||
      tileY < OUTER_WATER_RING ||
      tileX >= WIDTH - OUTER_WATER_RING ||
      tileY >= HEIGHT - OUTER_WATER_RING ||
      hasLand(tileX, tileY)
    )
      throw new Error(`Invalid water scenery placement for ${asset}.`);
    return {
      id: sceneryObjects.length + index + 1,
      name: asset,
      type: "water",
      x: (tileX + 0.5) * TILE_SIZE,
      y: (tileY + 1) * TILE_SIZE,
      point: true,
      rotation: 0,
      visible: true,
    };
  },
);

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (
      x < OUTER_WATER_RING ||
      y < OUTER_WATER_RING ||
      x >= WIDTH - OUTER_WATER_RING ||
      y >= HEIGHT - OUTER_WATER_RING
    ) {
      if (ground[indexOf(x, y)] !== 0 || collision[indexOf(x, y)] !== 1)
        throw new Error(
          `The outer two-tile water ring is broken at (${x}, ${y}).`,
        );
    }
  }
}

const walkable = collision
  .map((blocked, index) => (blocked === 0 ? index : -1))
  .filter((index) => index >= 0);
if (walkable.length < 210)
  throw new Error(`The island has only ${walkable.length} walkable cells.`);
const reachable = new Set([walkable[0]]);
const queue = [walkable[0]];
for (let read = 0; read < queue.length; read += 1) {
  const index = queue[read];
  const x = index % WIDTH;
  const y = Math.floor(index / WIDTH);
  for (const [nextX, nextY] of [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ]) {
    if (!isInside(nextX, nextY)) continue;
    const next = indexOf(nextX, nextY);
    if (collision[next] || reachable.has(next)) continue;
    reachable.add(next);
    queue.push(next);
  }
}
if (reachable.size !== walkable.length)
  throw new Error(
    `Walkable island is disconnected: ${reachable.size}/${walkable.length}.`,
  );

let nextLayerId = 1;
const tileLayer = (name, data, visible = true) => ({
  id: nextLayerId++,
  name,
  type: "tilelayer",
  width: WIDTH,
  height: HEIGHT,
  x: 0,
  y: 0,
  opacity: 1,
  visible,
  data,
});
const objectLayer = (name, objects) => ({
  id: nextLayerId++,
  name,
  type: "objectgroup",
  draworder: "topdown",
  opacity: 1,
  visible: true,
  x: 0,
  y: 0,
  objects,
});

const map = {
  compressionlevel: -1,
  height: HEIGHT,
  infinite: false,
  layers: [
    objectLayer("Water-Scenery", waterSceneryObjects),
    tileLayer("Flat-Ground", ground),
    objectLayer("Scenery", sceneryObjects),
    tileLayer("Collision", collision, false),
  ],
  nextlayerid: nextLayerId,
  nextobjectid: sceneryObjects.length + waterSceneryObjects.length + 1,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.11.2",
  tileheight: TILE_SIZE,
  tilesets: [
    {
      columns: ATLAS_COLUMNS,
      firstgid: 1,
      image: "../images/tiny-swords/tiny-swords-terrain-extruded.png",
      imageheight: ATLAS_SIZE,
      imagewidth: ATLAS_SIZE,
      margin: ATLAS_MARGIN,
      name: "tiny-swords-terrain",
      spacing: ATLAS_SPACING,
      tilecount: ATLAS_COLUMNS * ATLAS_ROWS,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
    },
  ],
  tilewidth: TILE_SIZE,
  type: "map",
  version: "1.10",
  width: WIDTH,
};

const sourceManifest = JSON.parse(await readFile(SOURCE_MANIFEST_PATH, "utf8"));
if (
  sourceManifest.project !== "Tiny Swords (Free Pack)" ||
  sourceManifest.files.length !== 32
)
  throw new Error("Tiny Swords source manifest selection is invalid.");
const sourceFiles = new Map();
for (const definition of sourceManifest.files) {
  const sourcePath = path.join(SOURCE_ROOT, definition.path);
  const bytes = await readFile(sourcePath);
  const metadata = await sharp(bytes).metadata();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    metadata.width !== definition.width ||
    metadata.height !== definition.height ||
    sha256 !== definition.sha256
  )
    throw new Error(`Tiny Swords source mismatch for ${definition.path}.`);
  sourceFiles.set(definition.path, bytes);
}

const waterBytes = sourceFiles.get(
  "Terrain/Tileset/Water Background color.png",
);
const { data: waterPixels, info: waterInfo } = await sharp(waterBytes)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (
  waterInfo.width !== TILE_SIZE ||
  waterInfo.height !== TILE_SIZE ||
  [...waterPixels].some(
    (value, index) => value !== WATER_COLOR[index % WATER_COLOR.length],
  )
)
  throw new Error("Tiny Swords water background must remain solid #47aba9.");

const tilemapBytes = sourceFiles.get("Terrain/Tileset/Tilemap_color1.png");
const composites = [];
for (const [sourceIndex, slot] of TERRAIN_SLOT_BY_SOURCE_INDEX) {
  const tile = await sharp(tilemapBytes)
    .extract({
      left: (sourceIndex % TERRAIN_SOURCE_COLUMNS) * TILE_SIZE,
      top: Math.floor(sourceIndex / TERRAIN_SOURCE_COLUMNS) * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
    })
    .extend({
      top: ATLAS_MARGIN,
      bottom: ATLAS_MARGIN,
      left: ATLAS_MARGIN,
      right: ATLAS_MARGIN,
      extendWith: "copy",
    })
    .png()
    .toBuffer();
  composites.push({
    input: tile,
    left: (slot % ATLAS_COLUMNS) * ATLAS_CELL_SIZE,
    top: Math.floor(slot / ATLAS_COLUMNS) * ATLAS_CELL_SIZE,
  });
}

await mkdir(path.dirname(RUNTIME_TERRAIN_PATH), { recursive: true });
await sharp({
  create: {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(RUNTIME_TERRAIN_PATH);

for (const [sourceRelativePath, runtimeRelativePath] of RUNTIME_ASSET_COPIES) {
  const target = path.join(RUNTIME_ROOT, runtimeRelativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, sourceFiles.get(sourceRelativePath));
}
await mkdir(PUBLISHED_EVIDENCE_ROOT, { recursive: true });
await copyFile(
  SOURCE_MANIFEST_PATH,
  path.join(PUBLISHED_EVIDENCE_ROOT, "SOURCE.json"),
);
await copyFile(
  SOURCE_TERMS_PATH,
  path.join(PUBLISHED_EVIDENCE_ROOT, "TERMS.md"),
);
await mkdir(path.dirname(MAP_PATH), { recursive: true });
await writeFile(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`, "utf8");

console.log(
  `Generated Monster Tamer water home ${WIDTH}x${HEIGHT}: ` +
    `${walkable.length} connected walkable cells, ` +
    `${sceneryObjects.length} island objects, ` +
    `${waterSceneryObjects.length} water objects.`,
);
