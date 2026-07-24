import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  TINY_SWORDS_ANIMATION_KEYS,
  TINY_SWORDS_ASSET_KEYS,
} from "../../apps/web/public/monster-tamer/src/assets/tiny-swords-world.js";

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

const WIDTH = 240;
const HEIGHT = 120;
const TILE_SIZE = 64;
const SIZE = WIDTH * HEIGHT;
const TERRAIN_SOURCE_COLUMNS = 9;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 8;
const ATLAS_MARGIN = 1;
const ATLAS_SPACING = 2;
const ATLAS_CELL_SIZE = TILE_SIZE + ATLAS_SPACING;
const ATLAS_SIZE = ATLAS_COLUMNS * ATLAS_CELL_SIZE;
const WATER_COLOR = Object.freeze([71, 171, 169, 255]);

const FIRST_GID = Object.freeze({
  TERRAIN: 1,
  COLLISION: 65,
  ENCOUNTER: 66,
});

const TERRAIN_SOURCE_INDICES = Object.freeze([
  0, 1, 2, 9, 10, 11, 18, 19, 20, 5, 6, 7, 14, 15, 16, 23, 24, 25, 41, 42, 43,
  44, 50, 51, 52, 53, 36, 39, 45, 48,
]);
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
const ELEVATED_PALETTE = Object.freeze({
  topLeft: 5,
  top: 6,
  topRight: 7,
  left: 14,
  center: 15,
  right: 16,
  bottomLeft: 23,
  bottom: 24,
  bottomRight: 25,
});
const CLIFF_PALETTE = Object.freeze({
  upperLeft: 41,
  upper: 42,
  upperRight: 43,
  upperSingle: 44,
  lowerLeft: 50,
  lower: 51,
  lowerRight: 52,
  lowerSingle: 53,
});
const STAIR_PALETTE = Object.freeze({
  upperLeft: 36,
  upperRight: 39,
  lowerLeft: 45,
  lowerRight: 48,
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
const isInsideMap = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const hash = (x, y, salt = 0) =>
  Math.abs(((x * 73_856_093) ^ (y * 19_349_663) ^ salt) >>> 0);
const terrainGid = (sourceIndex) => {
  const slot = TERRAIN_SLOT_BY_SOURCE_INDEX.get(sourceIndex);
  if (slot === undefined) {
    throw new Error(`Tiny Swords source tile ${sourceIndex} is not curated.`);
  }
  return FIRST_GID.TERRAIN + slot;
};

const flatGround = Array(SIZE).fill(0);
const elevationLevel1 = Array(SIZE).fill(0);
const elevationLevel2 = Array(SIZE).fill(0);
const collision = Array(SIZE).fill(0);
const encounter1 = Array(SIZE).fill(0);
const encounter2 = Array(SIZE).fill(0);
const encounter3 = Array(SIZE).fill(0);
const baseLandMask = new Uint8Array(SIZE);
const elevationLevel1Mask = new Uint8Array(SIZE);
const elevationLevel2Mask = new Uint8Array(SIZE);
const roadMask = new Uint8Array(SIZE);
const reservedTiles = new Set();

function setTile(layer, x, y, gid) {
  if (isInsideMap(x, y)) {
    layer[indexOf(x, y)] = gid;
  }
}

function hasMaskTile(mask, x, y) {
  return isInsideMap(x, y) && mask[indexOf(x, y)] === 1;
}

function fillRoundedRect(mask, x, y, width, height, radius) {
  const right = x + width - 1;
  const bottom = y + height - 1;
  for (let tileY = y; tileY <= bottom; tileY += 1) {
    for (let tileX = x; tileX <= right; tileX += 1) {
      const dx =
        tileX < x + radius
          ? x + radius - tileX
          : tileX > right - radius
            ? tileX - (right - radius)
            : 0;
      const dy =
        tileY < y + radius
          ? y + radius - tileY
          : tileY > bottom - radius
            ? tileY - (bottom - radius)
            : 0;
      if (dx * dx + dy * dy <= radius * radius) {
        mask[indexOf(tileX, tileY)] = 1;
      }
    }
  }
}

function tileForMask(mask, x, y, palette) {
  const north = hasMaskTile(mask, x, y - 1);
  const south = hasMaskTile(mask, x, y + 1);
  const west = hasMaskTile(mask, x - 1, y);
  const east = hasMaskTile(mask, x + 1, y);
  if (!north && !west) return palette.topLeft;
  if (!north && !east) return palette.topRight;
  if (!south && !west) return palette.bottomLeft;
  if (!south && !east) return palette.bottomRight;
  if (!north) return palette.top;
  if (!south) return palette.bottom;
  if (!west) return palette.left;
  if (!east) return palette.right;
  return palette.center;
}

function paintMask(layer, mask, palette) {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (hasMaskTile(mask, x, y)) {
        setTile(layer, x, y, terrainGid(tileForMask(mask, x, y, palette)));
      }
    }
  }
}

function blockTile(x, y) {
  setTile(collision, x, y, FIRST_GID.COLLISION);
}

function clearCollision(x, y) {
  setTile(collision, x, y, 0);
}

function markRoadDisk(centerX, centerY, radius) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (
        isInsideMap(x, y) &&
        Math.abs(x - centerX) + Math.abs(y - centerY) <= radius + 1
      ) {
        roadMask[indexOf(x, y)] = 1;
      }
    }
  }
}

function drawRoadPath(points, width = 3) {
  const radius = Math.max(1, Math.floor(width / 2));
  for (let index = 0; index < points.length - 1; index += 1) {
    const [startX, startY] = points[index];
    const [endX, endY] = points[index + 1];
    if (startX !== endX && startY !== endY) {
      throw new Error("Road paths must use orthogonal segments.");
    }
    const stepX = Math.sign(endX - startX);
    const stepY = Math.sign(endY - startY);
    let x = startX;
    let y = startY;
    markRoadDisk(x, y, radius);
    while (x !== endX || y !== endY) {
      x += stepX;
      y += stepY;
      markRoadDisk(x, y, radius);
    }
  }
}

function reserveTile(x, y, radius = 0) {
  for (let tileY = y - radius; tileY <= y + radius; tileY += 1) {
    for (let tileX = x - radius; tileX <= x + radius; tileX += 1) {
      if (isInsideMap(tileX, tileY)) {
        reservedTiles.add(`${tileX},${tileY}`);
      }
    }
  }
}

function reserveRect(x, y, width, height, padding = 0) {
  for (let tileY = y - height + 1 - padding; tileY <= y + padding; tileY += 1) {
    for (let tileX = x - padding; tileX < x + width + padding; tileX += 1) {
      if (isInsideMap(tileX, tileY)) {
        reservedTiles.add(`${tileX},${tileY}`);
      }
    }
  }
}

function isReserved(x, y) {
  return reservedTiles.has(`${x},${y}`);
}

function property(name, type, value) {
  return { name, type, value };
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

function sceneryObject({
  name,
  assetKey,
  animationKey,
  frameCount = 1,
  x,
  y,
  width,
  height,
  originX,
  originY,
  depthMode,
  fixedDepth = 0,
}) {
  return {
    height,
    id: nextObjectId++,
    name,
    rotation: 0,
    type: "scenery",
    visible: true,
    width,
    x,
    y,
    properties: [
      property("asset_key", "string", assetKey),
      property("animation_key", "string", animationKey || ""),
      property("frame_count", "int", frameCount),
      property("origin_x", "float", originX),
      property("origin_y", "float", originY),
      property("depth_mode", "string", depthMode),
      property("fixed_depth", "int", fixedDepth),
    ],
  };
}

function worldScenery({
  name,
  assetKey,
  animationKey,
  frameCount = 1,
  tileX,
  tileY,
  width,
  height,
  originX = 0.5,
  originY = 1,
}) {
  return sceneryObject({
    name,
    assetKey,
    animationKey,
    frameCount,
    x: (tileX + originX) * TILE_SIZE,
    y: (tileY + 1) * TILE_SIZE,
    width,
    height,
    originX,
    originY,
    depthMode: "WORLD",
  });
}

function fixedScenery({
  name,
  assetKey,
  animationKey,
  frameCount = 1,
  tileX,
  tileY,
  width,
  height,
  originX = 0.5,
  originY = 0.5,
  fixedDepth,
}) {
  return sceneryObject({
    name,
    assetKey,
    animationKey,
    frameCount,
    x: (tileX + 0.5) * TILE_SIZE,
    y: (tileY + 0.5) * TILE_SIZE,
    width,
    height,
    originX,
    originY,
    depthMode: "FIXED",
    fixedDepth,
  });
}

fillRoundedRect(baseLandMask, 12, 38, 218, 72, 10);
fillRoundedRect(baseLandMask, 34, 78, 168, 35, 8);
fillRoundedRect(baseLandMask, 78, 6, 84, 62, 10);
fillRoundedRect(baseLandMask, 144, 28, 84, 60, 10);
fillRoundedRect(elevationLevel1Mask, 80, 14, 80, 48, 7);
fillRoundedRect(elevationLevel2Mask, 86, 14, 68, 26, 6);

paintMask(flatGround, baseLandMask, FLAT_PALETTE);

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (!hasMaskTile(baseLandMask, x, y)) {
      blockTile(x, y);
    }
  }
}

const elevationBottomEdges = [];

function renderElevation(mask, layer, level, stairX) {
  paintMask(layer, mask, ELEVATED_PALETTE);
  const bottomEdges = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!hasMaskTile(mask, x, y)) continue;
      const boundary =
        !hasMaskTile(mask, x - 1, y) ||
        !hasMaskTile(mask, x + 1, y) ||
        !hasMaskTile(mask, x, y - 1) ||
        !hasMaskTile(mask, x, y + 1);
      if (boundary) blockTile(x, y);
      if (hasMaskTile(mask, x, y + 1)) continue;
      const left = !hasMaskTile(mask, x - 1, y);
      const right = !hasMaskTile(mask, x + 1, y);
      const upper =
        left && right
          ? CLIFF_PALETTE.upperSingle
          : left
            ? CLIFF_PALETTE.upperLeft
            : right
              ? CLIFF_PALETTE.upperRight
              : CLIFF_PALETTE.upper;
      const lower =
        left && right
          ? CLIFF_PALETTE.lowerSingle
          : left
            ? CLIFF_PALETTE.lowerLeft
            : right
              ? CLIFF_PALETTE.lowerRight
              : CLIFF_PALETTE.lower;
      setTile(layer, x, y + 1, terrainGid(upper));
      setTile(layer, x, y + 2, terrainGid(lower));
      blockTile(x, y + 1);
      blockTile(x, y + 2);
      bottomEdges.push([x, y]);
    }
  }
  const stairBottomY = Math.max(
    ...bottomEdges
      .filter(([x]) => x === stairX || x === stairX + 1)
      .map(([, y]) => y),
  );
  setTile(
    layer,
    stairX - 1,
    stairBottomY + 1,
    terrainGid(STAIR_PALETTE.upperLeft),
  );
  setTile(
    layer,
    stairX + 2,
    stairBottomY + 1,
    terrainGid(STAIR_PALETTE.upperRight),
  );
  setTile(
    layer,
    stairX - 1,
    stairBottomY + 2,
    terrainGid(STAIR_PALETTE.lowerLeft),
  );
  setTile(
    layer,
    stairX + 2,
    stairBottomY + 2,
    terrainGid(STAIR_PALETTE.lowerRight),
  );
  for (let y = stairBottomY - 1; y <= stairBottomY + 2; y += 1) {
    for (let x = stairX; x <= stairX + 2; x += 1) {
      clearCollision(x, y);
    }
  }
  elevationBottomEdges.push({ bottomEdges, level });
}

renderElevation(elevationLevel1Mask, elevationLevel1, 1, 118);
renderElevation(elevationLevel2Mask, elevationLevel2, 2, 118);

drawRoadPath(
  [
    [18, 68],
    [222, 68],
  ],
  5,
);
drawRoadPath(
  [
    [118, 68],
    [118, 32],
  ],
  3,
);
drawRoadPath(
  [
    [118, 68],
    [118, 104],
  ],
  3,
);
drawRoadPath(
  [
    [118, 94],
    [82, 94],
  ],
  3,
);
drawRoadPath(
  [
    [118, 94],
    [194, 94],
  ],
  3,
);
drawRoadPath(
  [
    [152, 68],
    [152, 58],
    [208, 58],
  ],
  3,
);
drawRoadPath(
  [
    [172, 58],
    [172, 78],
    [206, 78],
  ],
  3,
);
drawRoadPath(
  [
    [52, 68],
    [52, 56],
    [28, 56],
  ],
  3,
);

const signPlacements = Object.freeze([
  [1, 52, 84],
  [2, 116, 74],
  [3, 164, 64],
  [4, 114, 66],
  [5, 178, 72],
  [6, 152, 60],
  [7, 172, 60],
  [8, 84, 88],
  [9, 48, 58],
]);
const itemPlacements = Object.freeze([
  [1, 1, 30, 66],
  [2, 1, 74, 104],
  [3, 2, 90, 44],
  [4, 1, 216, 84],
  [5, 2, 194, 104],
  [6, 1, 120, 34],
]);
const npcPlacements = Object.freeze([
  [1, 124, 66, "IDLE"],
  [2, 114, 68, "CLOCKWISE"],
  [3, 122, 70, "IDLE"],
  [4, 184, 72, "IDLE"],
  [5, 94, 96, "IDLE"],
  [6, 168, 62, "IDLE"],
  [7, 46, 56, "IDLE"],
  [8, 126, 72, "IDLE"],
  [9, 120, 40, "IDLE"],
  [10, 82, 90, "IDLE"],
]);
const npc2Path = Object.freeze([
  [114, 69],
  [115, 69],
  [116, 69],
  [116, 68],
  [116, 67],
  [115, 67],
  [114, 67],
]);

const sceneryObjects = [];
const waterSceneryObjects = [];
const shadowLevel1Objects = [];
const shadowLevel2Objects = [];

const buildingPlacements = Object.freeze([
  {
    name: "castle",
    assetKey: TINY_SWORDS_ASSET_KEYS.CASTLE,
    x: 118,
    y: 28,
    width: 5,
    height: 4,
    collisionDepth: 2,
  },
  {
    name: "tower-west",
    assetKey: TINY_SWORDS_ASSET_KEYS.TOWER,
    x: 91,
    y: 30,
    width: 2,
    height: 4,
    collisionDepth: 1,
  },
  {
    name: "tower-east",
    assetKey: TINY_SWORDS_ASSET_KEYS.TOWER,
    x: 147,
    y: 30,
    width: 2,
    height: 4,
    collisionDepth: 1,
  },
  {
    name: "tower-south",
    assetKey: TINY_SWORDS_ASSET_KEYS.TOWER,
    x: 65,
    y: 98,
    width: 2,
    height: 4,
    collisionDepth: 1,
  },
  {
    name: "barracks",
    assetKey: TINY_SWORDS_ASSET_KEYS.BARRACKS,
    x: 103,
    y: 36,
    width: 3,
    height: 4,
    collisionDepth: 1,
  },
  {
    name: "archery",
    assetKey: TINY_SWORDS_ASSET_KEYS.ARCHERY,
    x: 135,
    y: 36,
    width: 3,
    height: 4,
    collisionDepth: 1,
  },
  {
    name: "monastery",
    assetKey: TINY_SWORDS_ASSET_KEYS.MONASTERY,
    x: 159,
    y: 78,
    width: 3,
    height: 5,
    collisionDepth: 1,
  },
  {
    name: "house-1-a",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_1,
    x: 165,
    y: 56,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
  {
    name: "house-1-b",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_1,
    x: 195,
    y: 70,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
  {
    name: "house-2-a",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_2,
    x: 177,
    y: 52,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
  {
    name: "house-2-b",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_2,
    x: 205,
    y: 58,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
  {
    name: "house-3-a",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_3,
    x: 189,
    y: 62,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
  {
    name: "house-3-b",
    assetKey: TINY_SWORDS_ASSET_KEYS.HOUSE_3,
    x: 175,
    y: 72,
    width: 2,
    height: 3,
    collisionDepth: 1,
  },
]);

for (const building of buildingPlacements) {
  sceneryObjects.push(
    worldScenery({
      name: building.name,
      assetKey: building.assetKey,
      tileX: building.x,
      tileY: building.y,
      width: building.width * TILE_SIZE,
      height: building.height * TILE_SIZE,
      originX: 0,
      originY: 1,
    }),
  );
  for (
    let y = building.y - building.collisionDepth + 1;
    y <= building.y;
    y += 1
  ) {
    for (let x = building.x; x < building.x + building.width; x += 1) {
      if (!hasMaskTile(baseLandMask, x, y)) {
        throw new Error(
          `${building.name} is outside the island at (${x}, ${y}).`,
        );
      }
      blockTile(x, y);
    }
  }
  reserveRect(building.x, building.y, building.width, building.height, 1);
}

for (const [, x, y] of signPlacements) {
  blockTile(x, y);
  reserveTile(x, y, 1);
  sceneryObjects.push(
    worldScenery({
      name: "stone-sign-marker",
      assetKey: TINY_SWORDS_ASSET_KEYS.ROCK_4,
      tileX: x,
      tileY: y,
      width: TILE_SIZE,
      height: TILE_SIZE,
    }),
  );
}

for (const [, , x, y] of itemPlacements) reserveTile(x, y, 1);
for (const [, x, y] of npcPlacements) reserveTile(x, y, 1);
for (const [x, y] of npc2Path) reserveTile(x, y, 1);
reserveTile(118, 68, 2);
reserveTile(122, 66, 2);

function chooseSceneryTiles({
  count,
  regions,
  salt,
  width = 1,
  height = 1,
  padding = 1,
}) {
  const candidates = new Map();
  for (const [left, top, right, bottom] of regions) {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        let valid = true;
        for (
          let footprintY = y - height + 1;
          footprintY <= y;
          footprintY += 1
        ) {
          for (let footprintX = x; footprintX < x + width; footprintX += 1) {
            if (
              !hasMaskTile(baseLandMask, footprintX, footprintY) ||
              collision[indexOf(footprintX, footprintY)] !== 0 ||
              roadMask[indexOf(footprintX, footprintY)] !== 0 ||
              isReserved(footprintX, footprintY)
            ) {
              valid = false;
            }
          }
        }
        if (valid) candidates.set(`${x},${y}`, [x, y]);
      }
    }
  }
  const ordered = [...candidates.values()].sort(
    ([ax, ay], [bx, by]) => hash(ax, ay, salt) - hash(bx, by, salt),
  );
  const selected = [];
  for (const [x, y] of ordered) {
    if (selected.length === count) break;
    let valid = true;
    for (let footprintY = y - height + 1; footprintY <= y; footprintY += 1) {
      for (let footprintX = x; footprintX < x + width; footprintX += 1) {
        if (isReserved(footprintX, footprintY)) valid = false;
      }
    }
    if (!valid) continue;
    selected.push([x, y]);
    reserveRect(x, y, width, height, padding);
  }
  if (selected.length !== count) {
    throw new Error(
      `Unable to place ${count} scenery objects; placed ${selected.length}.`,
    );
  }
  return selected;
}

const forestRegions = Object.freeze([
  [18, 40, 68, 78],
  [54, 72, 112, 108],
  [130, 76, 198, 108],
  [188, 36, 226, 108],
]);
const treeVariants = Object.freeze([
  [TINY_SWORDS_ASSET_KEYS.TREE_1, TINY_SWORDS_ANIMATION_KEYS.TREE_1, 256],
  [TINY_SWORDS_ASSET_KEYS.TREE_2, TINY_SWORDS_ANIMATION_KEYS.TREE_2, 256],
  [TINY_SWORDS_ASSET_KEYS.TREE_3, TINY_SWORDS_ANIMATION_KEYS.TREE_3, 192],
  [TINY_SWORDS_ASSET_KEYS.TREE_4, TINY_SWORDS_ANIMATION_KEYS.TREE_4, 192],
]);
chooseSceneryTiles({
  count: 48,
  regions: forestRegions,
  salt: 201,
  padding: 2,
}).forEach(([x, y], index) => {
  const [assetKey, animationKey, height] = treeVariants[index % 4];
  sceneryObjects.push(
    worldScenery({
      name: `tree-${index + 1}`,
      assetKey,
      animationKey,
      frameCount: 8,
      tileX: x,
      tileY: y,
      width: 192,
      height,
    }),
  );
  blockTile(x, y);
});

const stumpKeys = Object.freeze([
  TINY_SWORDS_ASSET_KEYS.STUMP_1,
  TINY_SWORDS_ASSET_KEYS.STUMP_2,
  TINY_SWORDS_ASSET_KEYS.STUMP_3,
  TINY_SWORDS_ASSET_KEYS.STUMP_4,
]);
chooseSceneryTiles({
  count: 8,
  regions: forestRegions,
  salt: 301,
  padding: 1,
}).forEach(([x, y], index) => {
  sceneryObjects.push(
    worldScenery({
      name: `stump-${index + 1}`,
      assetKey: stumpKeys[index % 4],
      tileX: x,
      tileY: y,
      width: 192,
      height: 256,
    }),
  );
  blockTile(x, y);
});

const bushVariants = Object.freeze([
  [TINY_SWORDS_ASSET_KEYS.BUSH_1, TINY_SWORDS_ANIMATION_KEYS.BUSH_1],
  [TINY_SWORDS_ASSET_KEYS.BUSH_2, TINY_SWORDS_ANIMATION_KEYS.BUSH_2],
  [TINY_SWORDS_ASSET_KEYS.BUSH_3, TINY_SWORDS_ANIMATION_KEYS.BUSH_3],
  [TINY_SWORDS_ASSET_KEYS.BUSH_4, TINY_SWORDS_ANIMATION_KEYS.BUSH_4],
]);
chooseSceneryTiles({
  count: 16,
  regions: forestRegions,
  salt: 401,
  width: 2,
  padding: 1,
}).forEach(([x, y], index) => {
  const [assetKey, animationKey] = bushVariants[index % 4];
  sceneryObjects.push(
    worldScenery({
      name: `bush-${index + 1}`,
      assetKey,
      animationKey,
      frameCount: 8,
      tileX: x,
      tileY: y,
      width: 128,
      height: 128,
      originX: 0,
      originY: 1,
    }),
  );
  blockTile(x, y);
  blockTile(x + 1, y);
});

const rockKeys = Object.freeze([
  TINY_SWORDS_ASSET_KEYS.ROCK_1,
  TINY_SWORDS_ASSET_KEYS.ROCK_2,
  TINY_SWORDS_ASSET_KEYS.ROCK_3,
  TINY_SWORDS_ASSET_KEYS.ROCK_4,
]);
chooseSceneryTiles({
  count: 20,
  regions: forestRegions,
  salt: 501,
  padding: 1,
}).forEach(([x, y], index) => {
  sceneryObjects.push(
    worldScenery({
      name: `rock-${index + 1}`,
      assetKey: rockKeys[index % 4],
      tileX: x,
      tileY: y,
      width: TILE_SIZE,
      height: TILE_SIZE,
    }),
  );
  blockTile(x, y);
});

const waterFoamPositions = Object.freeze([
  [20, 40],
  [32, 38],
  [50, 36],
  [70, 38],
  [84, 10],
  [110, 6],
  [140, 8],
  [160, 24],
  [180, 28],
  [210, 30],
  [228, 48],
  [232, 68],
  [228, 90],
  [212, 108],
  [190, 112],
  [164, 114],
  [138, 110],
  [110, 114],
  [82, 112],
  [52, 114],
  [34, 106],
  [14, 92],
  [10, 70],
  [12, 50],
]);
for (const [x, y] of waterFoamPositions) {
  waterSceneryObjects.push(
    fixedScenery({
      name: "water-foam",
      assetKey: TINY_SWORDS_ASSET_KEYS.WATER_FOAM,
      animationKey: TINY_SWORDS_ANIMATION_KEYS.WATER_FOAM,
      frameCount: 16,
      tileX: x,
      tileY: y,
      width: 192,
      height: 192,
      fixedDepth: -45,
    }),
  );
}

const waterRockPositions = Object.freeze([
  [6, 30],
  [24, 20],
  [52, 28],
  [70, 6],
  [172, 14],
  [208, 16],
  [234, 38],
  [236, 96],
  [218, 116],
  [154, 116],
  [74, 116],
  [8, 106],
]);
const waterRockVariants = Object.freeze([
  [
    TINY_SWORDS_ASSET_KEYS.WATER_ROCK_1,
    TINY_SWORDS_ANIMATION_KEYS.WATER_ROCK_1,
  ],
  [
    TINY_SWORDS_ASSET_KEYS.WATER_ROCK_2,
    TINY_SWORDS_ANIMATION_KEYS.WATER_ROCK_2,
  ],
  [
    TINY_SWORDS_ASSET_KEYS.WATER_ROCK_3,
    TINY_SWORDS_ANIMATION_KEYS.WATER_ROCK_3,
  ],
  [
    TINY_SWORDS_ASSET_KEYS.WATER_ROCK_4,
    TINY_SWORDS_ANIMATION_KEYS.WATER_ROCK_4,
  ],
]);
waterRockPositions.forEach(([x, y], index) => {
  const [assetKey, animationKey] = waterRockVariants[index % 4];
  waterSceneryObjects.push(
    fixedScenery({
      name: `water-rock-${index + 1}`,
      assetKey,
      animationKey,
      frameCount: 16,
      tileX: x,
      tileY: y,
      width: TILE_SIZE,
      height: TILE_SIZE,
      originX: 0.5,
      originY: 1,
      fixedDepth: -44,
    }),
  );
});

for (const { bottomEdges, level } of elevationBottomEdges) {
  const target = level === 1 ? shadowLevel1Objects : shadowLevel2Objects;
  const depth = level === 1 ? -35 : -25;
  bottomEdges
    .sort(([ax, ay], [bx, by]) => ay - by || ax - bx)
    .filter((_, index) => index % 5 === 0)
    .slice(0, 16)
    .forEach(([x, y], index) => {
      target.push(
        fixedScenery({
          name: `level-${level}-shadow-${index + 1}`,
          assetKey: TINY_SWORDS_ASSET_KEYS.SHADOW,
          tileX: x,
          tileY: y + 1,
          width: 192,
          height: 192,
          fixedDepth: depth,
        }),
      );
    });
}

function fillEncounter(layer, left, top, width, height) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (
        !isInsideMap(x, y) ||
        !hasMaskTile(baseLandMask, x, y) ||
        collision[indexOf(x, y)] !== 0 ||
        roadMask[indexOf(x, y)] !== 0
      ) {
        continue;
      }
      setTile(layer, x, y, FIRST_GID.ENCOUNTER);
    }
  }
}

fillEncounter(encounter1, 48, 84, 57, 27);
fillEncounter(encounter2, 184, 78, 41, 31);
fillEncounter(encounter3, 16, 38, 47, 39);

function reachableTilesFrom(startX, startY) {
  const reachable = new Uint8Array(SIZE);
  const queue = new Int32Array(SIZE);
  let readIndex = 0;
  let writeIndex = 0;
  const startIndex = indexOf(startX, startY);
  if (collision[startIndex]) return reachable;
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

const reachable = reachableTilesFrom(118, 68);
for (const [x, y, label] of [
  [118, 68, "player spawn"],
  [122, 66, "revive location"],
  [18, 68, "west road endpoint"],
  [222, 68, "east road endpoint"],
  [120, 34, "castle plateau"],
  [118, 104, "south exploration endpoint"],
  ...itemPlacements.map(([, , x, y]) => [x, y, "item"]),
  ...npcPlacements.map(([, x, y]) => [x, y, "npc"]),
  ...npc2Path.map(([x, y]) => [x, y, "NPC 2 path"]),
]) {
  if (
    !isInsideMap(x, y) ||
    collision[indexOf(x, y)] !== 0 ||
    reachable[indexOf(x, y)] !== 1
  ) {
    throw new Error(`${label} is not spawn-reachable at (${x}, ${y}).`);
  }
}

for (const [id, x, y] of signPlacements) {
  const hasReachableInteractionTile = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ].some(
    ([nextX, nextY]) =>
      isInsideMap(nextX, nextY) && reachable[indexOf(nextX, nextY)] === 1,
  );
  if (!hasReachableInteractionTile) {
    throw new Error(`Sign ${id} has no reachable interaction tile.`);
  }
}

for (const layer of [encounter1, encounter2, encounter3]) {
  for (let index = 0; index < SIZE; index += 1) {
    if (layer[index] && !reachable[index]) layer[index] = 0;
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
    throw new Error(`${kind} ${id} overlaps ${previous} at (${x}, ${y}).`);
  }
  occupiedGameplayTiles.set(key, `${kind} ${id}`);
}

const encounterGroup = {
  id: nextLayerId++,
  layers: [
    tileLayer("Encounter-Area-1", encounter1, true, [
      property("area", "int", 1),
      property("tileType", "string", "GRASS"),
    ]),
    tileLayer("Encounter-Area-2", encounter2, true, [
      property("area", "int", 2),
      property("tileType", "string", "GRASS"),
    ]),
    tileLayer("Encounter-Area-3", encounter3, true, [
      property("area", "int", 3),
      property("tileType", "string", "GRASS"),
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
    objectLayer("Water-Scenery", waterSceneryObjects, true),
    tileLayer("Flat-Ground", flatGround),
    objectLayer("Shadow-Level-1", shadowLevel1Objects, true),
    tileLayer("Elevation-Level-1", elevationLevel1),
    objectLayer("Shadow-Level-2", shadowLevel2Objects, true),
    tileLayer("Elevation-Level-2", elevationLevel2),
    objectLayer("Scenery", sceneryObjects, true),
    tileLayer("Collision", collision, false),
    encounterGroup,
    itemLayer,
    objectLayer("Area-Metadata", [
      tiledObject({
        name: "area_metadata",
        x: 118,
        y: 68,
        properties: [
          property("faint_location", "string", "main_1"),
          property("id", "int", 0),
        ],
      }),
    ]),
    objectLayer("Revive-Location", [tiledObject({ x: 122, y: 66 })]),
    signLayer,
    objectLayer("Player-Spawn-Location", [tiledObject({ x: 118, y: 68 })]),
    npcGroup,
  ],
  nextlayerid: nextLayerId,
  nextobjectid: nextObjectId,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.11.2",
  tileheight: TILE_SIZE,
  tilesets: [
    {
      columns: ATLAS_COLUMNS,
      firstgid: FIRST_GID.TERRAIN,
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
) {
  throw new Error("Tiny Swords source manifest selection is invalid.");
}
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
  ) {
    throw new Error(
      `Tiny Swords source mismatch for ${definition.path}: ` +
        `${metadata.width}x${metadata.height} ${sha256}.`,
    );
  }
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
) {
  throw new Error("Tiny Swords water background must remain solid #47aba9.");
}

const tilemapBytes = sourceFiles.get("Terrain/Tileset/Tilemap_color1.png");
const composites = [];
for (const [sourceIndex, slot] of TERRAIN_SLOT_BY_SOURCE_INDEX) {
  const sourceX = (sourceIndex % TERRAIN_SOURCE_COLUMNS) * TILE_SIZE;
  const sourceY = Math.floor(sourceIndex / TERRAIN_SOURCE_COLUMNS) * TILE_SIZE;
  const tile = await sharp(tilemapBytes)
    .extract({
      left: sourceX,
      top: sourceY,
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

await mkdir(RUNTIME_ROOT, { recursive: true });
await sharp({
  create: {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png({ compressionLevel: 9, palette: true })
  .toFile(RUNTIME_TERRAIN_PATH);

for (const [sourceRelativePath, runtimeRelativePath] of RUNTIME_ASSET_COPIES) {
  const destination = path.join(RUNTIME_ROOT, runtimeRelativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(SOURCE_ROOT, sourceRelativePath), destination);
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
await writeFile(MAP_PATH, `${JSON.stringify(map)}\n`);

console.log(
  `Generated Tiny Swords main_1 (${WIDTH}x${HEIGHT}, ${TILE_SIZE}px tiles), ` +
    `${sceneryObjects.length} world scenery objects, ` +
    `${waterSceneryObjects.length} water objects, 10 NPCs, 6 items, ` +
    "9 signs, and 3 encounter areas.",
);
