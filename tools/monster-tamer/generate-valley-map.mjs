import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const GAME_ROOT = path.join(ROOT, "apps/web/public/monster-tamer");
const SOURCE_ROOT = path.join(ROOT, "assets/source/monster-tamer/kenney-tiny");
const RUNTIME_IMAGE_ROOT = path.join(GAME_ROOT, "assets/images/kenney-tiny");
const MAP_PATH = path.join(GAME_ROOT, "assets/data/main_1.json");

const WIDTH = 480;
const HEIGHT = 240;
const TILE_SIZE = 64;
const SIZE = WIDTH * HEIGHT;

const FIRST_GID = Object.freeze({
  TOWN: 1,
  FARM: 133,
  BATTLE: 265,
  COLLISION: 276,
  ENCOUNTER: 277,
});

const BATTLE_SOURCE_TILE_INDICES = Object.freeze([
  18, 19, 20, 36, 37, 38, 55, 72, 73, 74, 91,
]);
const BATTLE_LOCAL_TILE_INDEX = new Map(
  BATTLE_SOURCE_TILE_INDICES.map((sourceIndex, localIndex) => [
    sourceIndex,
    localIndex,
  ]),
);
const town = (index) => FIRST_GID.TOWN + index;
const farm = (index) => FIRST_GID.FARM + index;
const battle = (sourceIndex) => {
  const localIndex = BATTLE_LOCAL_TILE_INDEX.get(sourceIndex);
  if (localIndex === undefined) {
    throw new Error(
      `Tiny Battle tile ${sourceIndex} is not in the natural-only runtime atlas.`,
    );
  }
  return FIRST_GID.BATTLE + localIndex;
};
const indexOf = (x, y) => y * WIDTH + x;
const isInsideMap = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const hash = (x, y, salt = 0) =>
  Math.abs(((x * 73_856_093) ^ (y * 19_349_663) ^ salt) >>> 0);

const ground = Array(SIZE).fill(town(0));
const terrain = Array(SIZE).fill(0);
const structures = Array(SIZE).fill(0);
const foreground = Array(SIZE).fill(0);
const collision = Array(SIZE).fill(0);
const encounter1 = Array(SIZE).fill(0);
const encounter2 = Array(SIZE).fill(0);
const encounter3 = Array(SIZE).fill(0);
const waterMask = new Uint8Array(SIZE);
const roadMask = new Uint8Array(SIZE);

function setTile(layer, x, y, gid) {
  if (isInsideMap(x, y)) {
    layer[indexOf(x, y)] = gid;
  }
}

function fillRect(layer, x, y, width, height, value) {
  for (let tileY = y; tileY < y + height; tileY += 1) {
    for (let tileX = x; tileX < x + width; tileX += 1) {
      setTile(
        layer,
        tileX,
        tileY,
        typeof value === "function" ? value(tileX, tileY) : value,
      );
    }
  }
}

function blockTile(x, y) {
  setTile(collision, x, y, FIRST_GID.COLLISION);
}

function clearCollision(x, y) {
  setTile(collision, x, y, 0);
}

function markRoad(x, y) {
  if (!isInsideMap(x, y)) return;
  roadMask[indexOf(x, y)] = 1;
}

function drawRoad(x, y, width, height) {
  for (let tileY = y; tileY < y + height; tileY += 1) {
    for (let tileX = x; tileX < x + width; tileX += 1) {
      markRoad(tileX, tileY);
    }
  }
}

function renderRoadTiles() {
  const roadTiles = [
    [12, 13, 14],
    [24, 25, 26],
    [36, 37, 38],
  ];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!roadMask[indexOf(x, y)]) continue;
      const north = y > 0 && roadMask[indexOf(x, y - 1)] === 1;
      const south = y < HEIGHT - 1 && roadMask[indexOf(x, y + 1)] === 1;
      const west = x > 0 && roadMask[indexOf(x - 1, y)] === 1;
      const east = x < WIDTH - 1 && roadMask[indexOf(x + 1, y)] === 1;
      const row = north ? (south ? 1 : 2) : 0;
      const column = west ? (east ? 1 : 2) : 0;
      setTile(terrain, x, y, town(roadTiles[row][column]));
    }
  }
}

function setWater(x, y) {
  if (isInsideMap(x, y)) {
    waterMask[indexOf(x, y)] = 1;
  }
}

function isWater(x, y) {
  return isInsideMap(x, y) && waterMask[indexOf(x, y)] === 1;
}

function waterTileAt(x, y) {
  const north = isWater(x, y - 1);
  const east = isWater(x + 1, y);
  const south = isWater(x, y + 1);
  const west = isWater(x - 1, y);

  if (!north && !west) return battle(18);
  if (!north && !east) return battle(20);
  if (!north) return battle(19);
  if (!south && !west) return battle(72);
  if (!south && !east) return battle(74);
  if (!south) return battle(73);
  if (!west) return battle(36);
  if (!east) return battle(38);
  return battle([37, 55, 91][hash(x, y, 11) % 3]);
}

function applyWater() {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!isWater(x, y)) continue;
      setTile(terrain, x, y, waterTileAt(x, y));
      blockTile(x, y);
    }
  }
}

function drawBridge(startY, height = 5) {
  const centers = [];
  for (let y = startY; y < startY + height; y += 1) {
    centers.push(335 + Math.round(Math.sin(y / 19) * 6 + Math.sin(y / 7) * 2));
  }
  const startX = Math.min(...centers) - 6;
  const endX = Math.max(...centers) + 6;

  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      markRoad(x, y);
      clearCollision(x, y);
    }
  }

  for (let x = startX; x <= endX; x += 1) {
    setTile(structures, x, startY - 1, town(81));
    setTile(foreground, x, startY + height, town(81));
    blockTile(x, startY - 1);
    blockTile(x, startY + height);
  }
}

function placeTree(x, y, variant = 0) {
  const treePairs = [
    [3, 15],
    [4, 16],
  ];
  if (
    !isInsideMap(x, y) ||
    !isInsideMap(x, y - 1) ||
    isWater(x, y) ||
    roadMask[indexOf(x, y)] ||
    roadMask[indexOf(x, y - 1)] ||
    collision[indexOf(x, y)] ||
    collision[indexOf(x, y - 1)]
  ) {
    return false;
  }
  const [top, bottom] = treePairs[variant % treePairs.length];
  setTile(foreground, x, y - 1, town(top));
  setTile(structures, x, y, town(bottom));
  blockTile(x, y - 1);
  blockTile(x, y);
  return true;
}

function scatterTrees(x, y, width, height, density, salt) {
  for (let tileY = y + 1; tileY < y + height; tileY += 2) {
    for (let tileX = x; tileX < x + width; tileX += 2) {
      if (hash(tileX, tileY, salt) % 100 >= density) continue;
      placeTree(tileX, tileY, hash(tileX, tileY, salt + 1) % 6);
    }
  }
}

function placeShrub(x, y, salt) {
  if (
    !isInsideMap(x, y) ||
    isWater(x, y) ||
    roadMask[indexOf(x, y)] ||
    collision[indexOf(x, y)] ||
    structures[indexOf(x, y)]
  ) {
    return false;
  }
  const shrubTiles = [39, 54, 56, 78];
  setTile(structures, x, y, farm(shrubTiles[hash(x, y, salt) % 4]));
  blockTile(x, y);
  return true;
}

function decorateLandscapeCluster(x, y, width, height, salt) {
  for (let tileY = y; tileY < y + height; tileY += 1) {
    for (let tileX = x; tileX < x + width; tileX += 1) {
      if (
        !isInsideMap(tileX, tileY) ||
        isWater(tileX, tileY) ||
        roadMask[indexOf(tileX, tileY)] ||
        structures[indexOf(tileX, tileY)]
      ) {
        continue;
      }
      if (hash(tileX, tileY, salt) % 100 < 24) {
        setTile(
          ground,
          tileX,
          tileY,
          town(hash(tileX, tileY, salt + 1) % 3 === 0 ? 2 : 1),
        );
      }
    }
  }
  for (let tileY = y + 2; tileY < y + height - 1; tileY += 4) {
    for (let tileX = x + 2; tileX < x + width - 1; tileX += 4) {
      if (hash(tileX, tileY, salt + 2) % 100 < 28) {
        placeShrub(tileX, tileY, salt + 3);
      }
    }
  }
  for (let tileY = y + 3; tileY < y + height - 1; tileY += 7) {
    for (let tileX = x + 3; tileX < x + width - 1; tileX += 7) {
      if (hash(tileX, tileY, salt + 4) % 100 < 42) {
        placeTree(tileX, tileY, hash(tileX, tileY, salt + 5) % 2);
      }
    }
  }
}

function drawFenceRect(x, y, width, height, gateTiles = []) {
  const gates = new Set(gateTiles.map(([gateX, gateY]) => `${gateX},${gateY}`));
  for (let tileX = x; tileX < x + width; tileX += 1) {
    for (const tileY of [y, y + height - 1]) {
      if (gates.has(`${tileX},${tileY}`)) continue;
      setTile(structures, tileX, tileY, town(45));
      blockTile(tileX, tileY);
    }
  }
  for (let tileY = y + 1; tileY < y + height - 1; tileY += 1) {
    for (const tileX of [x, x + width - 1]) {
      if (gates.has(`${tileX},${tileY}`)) continue;
      setTile(structures, tileX, tileY, town(56));
      blockTile(tileX, tileY);
    }
  }
  setTile(structures, x, y, town(44));
  setTile(structures, x + width - 1, y, town(46));
  setTile(structures, x, y + height - 1, town(68));
  setTile(structures, x + width - 1, y + height - 1, town(70));
}

function drawField(x, y, width, height, gateX, gateOnTop) {
  fillRect(terrain, x + 1, y + 1, width - 2, height - 2, (tileX, tileY) =>
    farm((tileX + tileY) % 5 === 0 ? 0 : 1),
  );
  const gateY = gateOnTop ? y : y + height - 1;
  drawFenceRect(x, y, width, height, [
    [gateX, gateY],
    [gateX + 1, gateY],
  ]);
  for (let tileY = y + 3; tileY < y + height - 2; tileY += 3) {
    for (let tileX = x + 3; tileX < x + width - 2; tileX += 3) {
      const crop = [4, 16, 28, 40, 52, 64][hash(tileX, tileY, 30) % 6];
      setTile(structures, tileX, tileY, farm(crop));
      blockTile(tileX, tileY);
    }
  }
}

function placeTownHouse(x, y, palette = "blue") {
  const rows =
    palette === "red"
      ? [
          [52, 53, 54],
          [64, 65, 66],
          [72, 86, 75],
        ]
      : [
          [48, 49, 50],
          [60, 61, 62],
          [76, 89, 79],
        ];
  rows.forEach((row, rowIndex) => {
    row.forEach((tile, columnIndex) => {
      setTile(structures, x + columnIndex, y + rowIndex, town(tile));
      blockTile(x + columnIndex, y + rowIndex);
    });
  });
}

function placeBarn(x, y) {
  const rows = [
    [90, 91, 92],
    [102, 103, 104],
    [114, 115, 116],
    [126, 127, 128],
  ];
  rows.forEach((row, rowIndex) => {
    row.forEach((tile, columnIndex) => {
      setTile(structures, x + columnIndex, y + rowIndex, farm(tile));
      blockTile(x + columnIndex, y + rowIndex);
    });
  });
}

function drawMountainEllipse(centerX, centerY, radiusX, radiusY, salt) {
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      const normalized =
        ((x - centerX) * (x - centerX)) / (radiusX * radiusX) +
        ((y - centerY) * (y - centerY)) / (radiusY * radiusY);
      if (
        normalized > 1 ||
        !isInsideMap(x, y) ||
        isWater(x, y) ||
        roadMask[indexOf(x, y)]
      ) {
        continue;
      }
      setTile(structures, x, y, town(120 + (hash(x, y, salt) % 3)));
      blockTile(x, y);
    }
  }
}

function placeSignVisual(x, y) {
  setTile(structures, x, y, town(83));
  blockTile(x, y);
  setTile(encounter1, x, y, 0);
  setTile(encounter2, x, y, 0);
  setTile(encounter3, x, y, 0);
}

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const variation = hash(x, y, 3);
    if (variation % 149 === 0) {
      setTile(ground, x, y, town(1));
    } else if (variation % 211 === 0) {
      setTile(ground, x, y, town(2));
    }
  }
}

// Primary roads keep the 480-tile-wide valley readable and traversable.
drawRoad(4, 125, 466, 3);
drawRoad(52, 10, 5, 116);
drawRoad(108, 78, 5, 132);
drawRoad(239, 20, 3, 207);
drawRoad(458, 74, 5, 135);
drawRoad(52, 78, 411, 5);
drawRoad(108, 184, 355, 5);
drawRoad(228, 117, 28, 3);
drawRoad(228, 136, 28, 3);
drawRoad(228, 117, 3, 22);
drawRoad(253, 117, 3, 22);

// Western farm lanes and a southern return trail.
drawRoad(60, 134, 104, 4);
drawRoad(101, 90, 5, 92);
drawRoad(154, 90, 5, 94);
drawRoad(52, 205, 191, 5);

// The eastern coast has an irregular sand-colored shoreline.
for (let y = 3; y < HEIGHT - 3; y += 1) {
  const shoreX = 472 + Math.round(Math.sin(y / 13) + Math.sin(y / 31));
  for (let x = shoreX - 6; x < shoreX; x += 1) {
    const localX = x - (shoreX - 6);
    setTile(terrain, x, y, town(localX === 0 ? 24 : localX === 5 ? 26 : 25));
  }
  for (let x = shoreX; x < WIDTH; x += 1) {
    setWater(x, y);
  }
}

// Northern lake and its winding river.
for (let y = 20; y <= 66; y += 1) {
  for (let x = 296; x <= 372; x += 1) {
    const normalized =
      ((x - 334) * (x - 334)) / (34 * 34) + ((y - 43) * (y - 43)) / (21 * 21);
    if (normalized <= 1) setWater(x, y);
  }
}
for (let y = 59; y < HEIGHT - 6; y += 1) {
  const centerX = 335 + Math.round(Math.sin(y / 19) * 6 + Math.sin(y / 7) * 2);
  const halfWidth = y > 210 ? 5 : 4;
  for (let x = centerX - halfWidth; x <= centerX + halfWidth; x += 1) {
    setWater(x, y);
  }
}
applyWater();

drawBridge(78);
drawBridge(125, 3);
drawBridge(184);
renderRoadTiles();

// Four cultivated plots, a barn, and two farmhouse buildings.
drawField(65, 91, 34, 28, 81, false);
drawField(116, 91, 35, 28, 133, false);
drawField(65, 140, 34, 29, 81, true);
drawField(116, 140, 35, 29, 133, true);
placeBarn(164, 100);
placeTownHouse(164, 132, "red");
placeTownHouse(180, 147, "blue");
fillRect(structures, 160, 115, 24, 1, farm(83));

// The central village is a compact, non-enterable outdoor landmark.
placeTownHouse(214, 99, "blue");
placeTownHouse(233, 111, "red");
placeTownHouse(263, 99, "blue");
placeTownHouse(233, 130, "blue");
placeTownHouse(247, 130, "red");
placeTownHouse(275, 136, "red");
placeTownHouse(244, 121, "blue");
setTile(structures, 243, 130, town(104));
blockTile(243, 130);
for (const [x, y] of [
  [220, 114],
  [236, 122],
  [269, 115],
  [258, 142],
]) {
  setTile(structures, x, y, town(94));
  blockTile(x, y);
}
for (const [x, y] of [
  [234, 124],
  [237, 121],
  [241, 121],
  [247, 126],
  [236, 133],
  [249, 134],
]) {
  setTile(ground, x, y, town(2));
}
placeTree(234, 122, 1);
placeTree(250, 122, 4);

// Hand-shaped meadow clusters keep long travel scenic without narrowing roads.
decorateLandscapeCluster(188, 111, 29, 30, 71);
decorateLandscapeCluster(280, 105, 31, 37, 72);
decorateLandscapeCluster(274, 151, 43, 30, 73);
decorateLandscapeCluster(178, 158, 37, 23, 82);
decorateLandscapeCluster(200, 211, 31, 22, 83);
decorateLandscapeCluster(250, 204, 31, 25, 84);
decorateLandscapeCluster(286, 31, 22, 38, 74);
decorateLandscapeCluster(374, 35, 22, 38, 75);
decorateLandscapeCluster(306, 91, 22, 29, 76);
decorateLandscapeCluster(349, 142, 25, 37, 77);
decorateLandscapeCluster(363, 194, 38, 37, 78);
decorateLandscapeCluster(408, 143, 41, 35, 79);
decorateLandscapeCluster(298, 195, 27, 32, 80);
decorateLandscapeCluster(347, 197, 18, 29, 81);

// Stone ridges establish the mountain region while retaining two wide passes.
drawMountainEllipse(184, 14, 62, 18, 41);
drawMountainEllipse(406, 16, 51, 19, 42);
drawMountainEllipse(272, 7, 34, 10, 43);

// Dense forests frame the west and north-east without obstructing the roads.
scatterTrees(4, 4, 91, 111, 74, 51);
scatterTrees(4, 158, 63, 77, 70, 52);
scatterTrees(400, 27, 64, 77, 61, 53);
scatterTrees(406, 199, 57, 36, 58, 54);

// A continuous wooded boundary prevents leaving the authored world.
fillRect(collision, 0, 0, WIDTH, 3, FIRST_GID.COLLISION);
fillRect(collision, 0, HEIGHT - 3, WIDTH, 3, FIRST_GID.COLLISION);
fillRect(collision, 0, 0, 3, HEIGHT, FIRST_GID.COLLISION);
fillRect(collision, WIDTH - 3, 0, 3, HEIGHT, FIRST_GID.COLLISION);
for (let x = 4; x < WIDTH - 4; x += 3) {
  placeTree(x, 4, hash(x, 4, 61) % 6);
  placeTree(x, HEIGHT - 3, hash(x, HEIGHT - 3, 62) % 6);
}

// Keep the three existing encounter identities, now distributed by biome.
function fillEncounter(layer, x, y, width, height) {
  for (let tileY = y; tileY < y + height; tileY += 1) {
    for (let tileX = x; tileX < x + width; tileX += 1) {
      if (
        !isInsideMap(tileX, tileY) ||
        collision[indexOf(tileX, tileY)] ||
        roadMask[indexOf(tileX, tileY)] ||
        isWater(tileX, tileY)
      ) {
        continue;
      }
      setTile(layer, tileX, tileY, FIRST_GID.ENCOUNTER);
    }
  }
}
fillEncounter(encounter1, 72, 173, 78, 45);
fillEncounter(encounter2, 356, 92, 100, 83);
fillEncounter(encounter3, 17, 31, 75, 70);

const signPlacements = [
  [1, 105, 121],
  [2, 225, 121],
  [3, 260, 121],
  [4, 240, 134],
  [5, 348, 121],
  [6, 205, 121],
  [7, 270, 111],
  [8, 158, 150],
  [9, 54, 96],
];
signPlacements.forEach(([, x, y]) => placeSignVisual(x, y));

const itemPlacements = [
  [1, 1, 28, 126],
  [2, 1, 120, 185],
  [3, 2, 296, 84],
  [4, 1, 385, 160],
  [5, 2, 460, 126],
  [6, 1, 240, 45],
];

const npcPlacements = [
  [1, 247, 121, "IDLE"],
  [2, 232, 118, "CLOCKWISE"],
  [3, 232, 136, "IDLE"],
  [4, 352, 125, "IDLE"],
  [5, 108, 181, "IDLE"],
  [6, 264, 112, "IDLE"],
  [7, 54, 90, "IDLE"],
  [8, 158, 145, "IDLE"],
  [9, 300, 80, "IDLE"],
  [10, 162, 145, "IDLE"],
];

const npc2Path = [
  [233, 118],
  [234, 118],
  [235, 118],
  [235, 119],
  [235, 120],
  [234, 120],
  [233, 120],
  [232, 120],
  [232, 119],
];

function reachableTilesFrom(startX, startY) {
  const reachable = new Uint8Array(SIZE);
  const queue = new Int32Array(SIZE);
  let readIndex = 0;
  let writeIndex = 0;
  const startIndex = indexOf(startX, startY);
  if (collision[startIndex]) {
    return reachable;
  }
  reachable[startIndex] = 1;
  queue[writeIndex++] = startIndex;
  while (readIndex < writeIndex) {
    const index = queue[readIndex++];
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    for (const [nextX, nextY] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (!isInsideMap(nextX, nextY)) continue;
      const nextIndex = indexOf(nextX, nextY);
      if (reachable[nextIndex] || collision[nextIndex]) continue;
      reachable[nextIndex] = 1;
      queue[writeIndex++] = nextIndex;
    }
  }
  return reachable;
}

const reachable = reachableTilesFrom(240, 126);
let reachableMinX = WIDTH;
let reachableMaxX = -1;
for (let index = 0; index < SIZE; index += 1) {
  if (!reachable[index]) continue;
  const x = index % WIDTH;
  reachableMinX = Math.min(reachableMinX, x);
  reachableMaxX = Math.max(reachableMaxX, x);
}
if (reachableMaxX - reachableMinX < 455) {
  throw new Error(
    `The spawn-connected valley must span at least 455 tiles horizontally; got ${reachableMaxX - reachableMinX}.`,
  );
}

for (const layer of [encounter1, encounter2, encounter3]) {
  for (let index = 0; index < SIZE; index += 1) {
    if (layer[index] && !reachable[index]) {
      layer[index] = 0;
    }
  }
  if (!layer.some(Boolean)) {
    throw new Error("Every encounter area must retain reachable tiles.");
  }
}

const occupiedGameplayTiles = new Map();
for (const [kind, id, x, y] of [
  ...itemPlacements.map(([id, , x, y]) => ["item", id, x, y]),
  ...npcPlacements.map(([id, x, y]) => ["npc", id, x, y]),
]) {
  const key = `${x},${y}`;
  const previous = occupiedGameplayTiles.get(key);
  if (previous) {
    throw new Error(`${kind} ${id} overlaps ${previous} at tile (${x}, ${y}).`);
  }
  occupiedGameplayTiles.set(key, `${kind} ${id}`);
}

const gameplayWalkableTiles = [
  [240, 126, "player spawn"],
  [246, 124, "revive location"],
  ...itemPlacements.map(([, , x, y]) => [x, y, "item"]),
  ...npcPlacements.map(([, x, y]) => [x, y, "npc"]),
  ...npc2Path.map(([x, y]) => [x, y, "NPC 2 path"]),
];
for (const [x, y, label] of gameplayWalkableTiles) {
  if (
    !isInsideMap(x, y) ||
    collision[indexOf(x, y)] ||
    !reachable[indexOf(x, y)]
  ) {
    throw new Error(
      `${label} must be open and spawn-reachable at tile (${x}, ${y}).`,
    );
  }
}

let nextLayerId = 1;
let nextObjectId = 1;

function tileLayer(name, data, visible = true, properties) {
  return {
    data,
    height: HEIGHT,
    id: nextLayerId++,
    name,
    opacity: 1,
    type: "tilelayer",
    visible,
    width: WIDTH,
    x: 0,
    y: 0,
    ...(properties ? { properties } : {}),
  };
}

function tiledObject({
  name = "",
  type = "",
  x,
  y,
  width = TILE_SIZE,
  height = TILE_SIZE,
  properties,
}) {
  return {
    height,
    id: nextObjectId++,
    name,
    rotation: 0,
    type,
    visible: true,
    width,
    x: x * TILE_SIZE,
    y: (y + 1) * TILE_SIZE,
    ...(properties ? { properties } : {}),
  };
}

function objectLayer(name, objects, visible = false) {
  return {
    draworder: "topdown",
    id: nextLayerId++,
    name,
    objects,
    opacity: 1,
    type: "objectgroup",
    visible,
    x: 0,
    y: 0,
  };
}

function property(name, type, value, propertytype) {
  return {
    name,
    ...(propertytype ? { propertytype } : {}),
    type,
    value,
  };
}

const encounterGroup = {
  id: nextLayerId++,
  layers: [
    tileLayer("Encounter-Area-1", encounter1, true, [
      property("area", "int", 1),
      property("tileType", "string", "GRASS", "encounterTileType"),
    ]),
    tileLayer("Encounter-Area-2", encounter2, true, [
      property("area", "int", 2),
      property("tileType", "string", "GRASS", "encounterTileType"),
    ]),
    tileLayer("Encounter-Area-3", encounter3, true, [
      property("area", "int", 3),
      property("tileType", "string", "GRASS", "encounterTileType"),
    ]),
  ],
  name: "Encounter",
  opacity: 1,
  type: "group",
  visible: false,
  x: 0,
  y: 0,
};

const itemLayer = objectLayer(
  "Item",
  itemPlacements.map(([id, itemId, x, y]) =>
    tiledObject({
      name: "item",
      x,
      y,
      properties: [
        property("id", "int", id),
        property("item_id", "int", itemId),
      ],
    }),
  ),
);

const areaMetadataLayer = objectLayer("Area-Metadata", [
  tiledObject({
    name: "area_metadata",
    x: 240,
    y: 126,
    properties: [
      property("faint_location", "string", "main_1"),
      property("id", "int", 0),
    ],
  }),
]);

const reviveLayer = objectLayer("Revive-Location", [
  tiledObject({ x: 246, y: 124 }),
]);

const signLayer = objectLayer(
  "Sign",
  signPlacements.map(([id, x, y]) =>
    tiledObject({
      name: "sign",
      x,
      y,
      properties: [property("id", "int", id)],
    }),
  ),
);

const playerSpawnLayer = objectLayer("Player-Spawn-Location", [
  tiledObject({ x: 240, y: 126 }),
]);

const npcLayers = npcPlacements.map(([id, x, y, movementPattern]) => {
  const objects = [
    tiledObject({
      name: "npc",
      type: "npc",
      x,
      y,
      properties: [
        property("id", "int", id),
        property("movement_pattern", "string", movementPattern),
      ],
    }),
  ];
  if (id === 2) {
    npc2Path.forEach(([pathX, pathY], pathIndex) => {
      objects.push(
        tiledObject({
          name: String(pathIndex + 1),
          type: "npc_path",
          x: pathX,
          y: pathY,
        }),
      );
    });
  }
  return objectLayer(`NPC${id}`, objects, true);
});

const npcGroup = {
  id: nextLayerId++,
  layers: npcLayers,
  name: "NPC",
  opacity: 1,
  type: "group",
  visible: false,
  x: 0,
  y: 0,
};

const map = {
  compressionlevel: -1,
  height: HEIGHT,
  infinite: false,
  layers: [
    tileLayer("Ground", ground),
    tileLayer("Terrain", terrain),
    tileLayer("Structures", structures),
    tileLayer("Collision", collision, false),
    encounterGroup,
    itemLayer,
    areaMetadataLayer,
    reviveLayer,
    signLayer,
    playerSpawnLayer,
    npcGroup,
    tileLayer("Foreground", foreground),
  ],
  nextlayerid: nextLayerId,
  nextobjectid: nextObjectId,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.11.2",
  tileheight: TILE_SIZE,
  tilesets: [
    {
      columns: 12,
      firstgid: FIRST_GID.TOWN,
      image: "../images/kenney-tiny/tiny-town-4x.png",
      imageheight: 704,
      imagewidth: 768,
      margin: 0,
      name: "tiny-town",
      spacing: 0,
      tilecount: 132,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
    },
    {
      columns: 12,
      firstgid: FIRST_GID.FARM,
      image: "../images/kenney-tiny/tiny-farm-4x.png",
      imageheight: 704,
      imagewidth: 768,
      margin: 0,
      name: "tiny-farm",
      spacing: 0,
      tilecount: 132,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
    },
    {
      columns: 11,
      firstgid: FIRST_GID.BATTLE,
      image: "../images/kenney-tiny/tiny-battle-4x.png",
      imageheight: 64,
      imagewidth: 704,
      margin: 0,
      name: "tiny-battle",
      spacing: 0,
      tilecount: 11,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
    },
    {
      columns: 1,
      firstgid: FIRST_GID.COLLISION,
      image: "../images/monster-tamer/map/collision.png",
      imageheight: TILE_SIZE,
      imagewidth: TILE_SIZE,
      margin: 0,
      name: "collision",
      spacing: 0,
      tilecount: 1,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
    },
    {
      columns: 1,
      firstgid: FIRST_GID.ENCOUNTER,
      image: "../images/monster-tamer/map/encounter.png",
      imageheight: TILE_SIZE,
      imagewidth: TILE_SIZE,
      margin: 0,
      name: "encounter",
      spacing: 0,
      tilecount: 1,
      tileheight: TILE_SIZE,
      tilewidth: TILE_SIZE,
      transformations: {
        hflip: false,
        preferuntransformed: true,
        rotate: false,
        vflip: false,
      },
    },
  ],
  tilewidth: TILE_SIZE,
  type: "map",
  version: "1.10",
  width: WIDTH,
};

const atlasJobs = [
  {
    source: path.join(SOURCE_ROOT, "tiny-town-1.1/tilemap_packed.png"),
    output: path.join(RUNTIME_IMAGE_ROOT, "tiny-town-4x.png"),
  },
  {
    source: path.join(SOURCE_ROOT, "tiny-farm-1.0/tilemap_packed.png"),
    output: path.join(RUNTIME_IMAGE_ROOT, "tiny-farm-4x.png"),
  },
  {
    source: path.join(SOURCE_ROOT, "tiny-battle-1.0/tilemap_packed.png"),
    output: path.join(RUNTIME_IMAGE_ROOT, "tiny-battle-4x.png"),
    naturalBattleTilesOnly: true,
  },
];

await mkdir(RUNTIME_IMAGE_ROOT, { recursive: true });
await Promise.all(
  atlasJobs.map(async ({ source, output, naturalBattleTilesOnly = false }) => {
    if (naturalBattleTilesOnly) {
      const tiles = await Promise.all(
        BATTLE_SOURCE_TILE_INDICES.map((sourceIndex) =>
          sharp(source)
            .extract({
              left: (sourceIndex % 18) * 16,
              top: Math.floor(sourceIndex / 18) * 16,
              width: 16,
              height: 16,
            })
            .resize(64, 64, { kernel: sharp.kernel.nearest })
            .png({ compressionLevel: 9 })
            .toBuffer(),
        ),
      );
      await sharp({
        create: {
          width: tiles.length * 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(
          tiles.map((input, index) => ({
            input,
            left: index * 64,
            top: 0,
          })),
        )
        .png({ compressionLevel: 9 })
        .toFile(output);
      return;
    }
    const image = sharp(source);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`Unable to read atlas dimensions: ${source}`);
    }
    await image
      .resize(metadata.width * 4, metadata.height * 4, {
        kernel: sharp.kernel.nearest,
      })
      .png({ compressionLevel: 9 })
      .toFile(output);
  }),
);
await writeFile(MAP_PATH, `${JSON.stringify(map)}\n`);

console.log(
  `Generated main_1 (${WIDTH}x${HEIGHT}, ${TILE_SIZE}px tiles), 3 runtime atlases, 10 NPCs, 6 items, 9 signs, and 3 encounter areas.`,
);
