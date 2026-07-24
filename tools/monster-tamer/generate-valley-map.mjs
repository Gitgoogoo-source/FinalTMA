import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const GAME_ROOT = path.join(ROOT, "apps/web/public/monster-tamer");
const TUXEMON_COMMIT = "c34a9c727129999671e4206ade7425cbb45745b4";
const SOURCE_ROOT = path.join(
  ROOT,
  "assets/source/monster-tamer/tuxemon",
  TUXEMON_COMMIT,
);
const RUNTIME_IMAGE_ROOT = path.join(
  GAME_ROOT,
  "assets/images/tuxemon",
);
const RUNTIME_ATLAS_PATH = path.join(
  RUNTIME_IMAGE_ROOT,
  "tuxemon-valley-4x-extruded.png",
);
const MAP_PATH = path.join(GAME_ROOT, "assets/data/main_1.json");

const WIDTH = 480;
const HEIGHT = 240;
const TILE_SIZE = 64;
const SIZE = WIDTH * HEIGHT;
const SOURCE_TILE_SIZE = 16;
const ATLAS_COLUMNS = 16;
const ATLAS_ROWS = 16;
const ATLAS_MARGIN = 1;
const ATLAS_SPACING = 2;
const ATLAS_CELL_SIZE = TILE_SIZE + ATLAS_SPACING;
const ATLAS_SIZE = ATLAS_COLUMNS * ATLAS_CELL_SIZE;

const FIRST_GID = Object.freeze({
  TUXEMON: 1,
  COLLISION: 257,
  ENCOUNTER: 258,
});

const SOURCE_DEFINITIONS = Object.freeze({
  city: Object.freeze({
    file: "core_city_and_country.png",
    width: 640,
    height: 576,
    columns: 40,
    sha256:
      "1cdf4a534a7e3078f3d18022c690022582b3a84cfefef4f7d02c739872b39178",
  }),
  nature: Object.freeze({
    file: "core_outdoor_nature.png",
    width: 1024,
    height: 2048,
    columns: 64,
    sha256:
      "c1c58c5115c35a730743c4e0bd9b48c05b77d38f1873d16216b924f9a33712aa",
  }),
  outdoor: Object.freeze({
    file: "core_outdoor.png",
    width: 592,
    height: 1200,
    columns: 37,
    sha256:
      "a3b62b7113408450f6af3c8d86ef287fe78cabd1bb7b9580414bcace4d90ff08",
  }),
  water: Object.freeze({
    file: "core_outdoor_water.png",
    width: 1024,
    height: 2048,
    columns: 64,
    sha256:
      "571fc2ad3a648424da78fb9d1abfe9027b7a9a6ef39e8f2b4d28e0eb2e3cc2f6",
  }),
});

const CURATED_TILE_INDICES = Object.freeze({
  city: Object.freeze([
    0, 1, 7, 8, 9, 12, 13, 14, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    55, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 126, 127, 128, 129,
    130, 131, 132, 133, 134, 135, 166, 167, 168, 169, 170, 171, 172,
    173, 174, 175, 320, 321, 382, 383, 384, 422, 423, 424, 443, 462,
    463, 464, 483, 1160, 1162, 1174, 1175, 1176, 1200, 1201, 1202,
    1240, 1241, 1242, 1280, 1281, 1282, 1320, 1321, 1360, 1361, 1400,
    1401,
  ]),
  nature: Object.freeze([
    40, 41, 42, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
    58, 59, 60, 61, 62, 63, 110, 111, 112, 113, 114, 115, 116, 123,
    124, 125, 126, 127, 168, 169, 170, 171, 174, 175, 176, 177, 178,
    179, 180, 187, 188, 189, 190, 191, 232, 233, 234, 235,
  ]),
  outdoor: Object.freeze([
    953, 954, 955, 978, 979, 980, 990, 991, 992, 1015, 1016, 1017,
    1052, 1053, 1054, 1060, 1061, 1062, 1063, 1064, 1065, 1097, 1098,
    1099, 1134, 1135, 1136, 1137, 1283, 1284, 1285, 1288, 1289, 1322,
    1323, 1324, 1325, 1326, 1327, 1328, 1329, 1359,
    1360, 1361, 1362, 1364, 1365, 1366, 1367, 1368,
  ]),
  water: Object.freeze([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    18, 19, 20, 21, 22, 23, 24, 25, 64, 65, 66, 67, 68, 69,
  ]),
});

const TUXEMON_TILE_MANIFEST = Object.freeze(
  Object.entries(CURATED_TILE_INDICES).flatMap(([source, indices]) =>
    indices.map((sourceIndex) => Object.freeze({ source, sourceIndex })),
  ),
);
if (TUXEMON_TILE_MANIFEST.length > 256) {
  throw new Error(
    `The curated Tuxemon atlas exceeds 256 slots: ${TUXEMON_TILE_MANIFEST.length}.`,
  );
}
const TUXEMON_TILE_SLOT = new Map(
  TUXEMON_TILE_MANIFEST.map(({ source, sourceIndex }, slot) => [
    `${source}:${sourceIndex}`,
    slot,
  ]),
);
const tuxemon = (source, sourceIndex) => {
  const slot = TUXEMON_TILE_SLOT.get(`${source}:${sourceIndex}`);
  if (slot === undefined) {
    throw new Error(
      `Tuxemon tile ${source}:${sourceIndex} is not in the curated atlas.`,
    );
  }
  return FIRST_GID.TUXEMON + slot;
};
const indexOf = (x, y) => y * WIDTH + x;
const isInsideMap = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const hash = (x, y, salt = 0) =>
  Math.abs(((x * 73_856_093) ^ (y * 19_349_663) ^ salt) >>> 0);

const ground = Array(SIZE).fill(tuxemon("city", 0));
const terrain = Array(SIZE).fill(0);
const structures = Array(SIZE).fill(0);
const foreground = Array(SIZE).fill(0);
const collision = Array(SIZE).fill(0);
const encounter1 = Array(SIZE).fill(0);
const encounter2 = Array(SIZE).fill(0);
const encounter3 = Array(SIZE).fill(0);
const waterMask = new Uint8Array(SIZE);
const roadMask = new Uint8Array(SIZE);
const bridgeMask = new Uint8Array(SIZE);

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

function drawRoadDisk(centerX, centerY, radius) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.abs(x - centerX) + Math.abs(y - centerY) <= radius + 1) {
        markRoad(x, y);
      }
    }
  }
}

function drawRoadPath(points, width = 3) {
  const radius = Math.max(1, Math.floor(width / 2));
  for (let index = 0; index < points.length - 1; index += 1) {
    const [startX, startY] = points[index];
    const [endX, endY] = points[index + 1];
    const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
    for (let step = 0; step <= steps; step += 1) {
      const progress = steps === 0 ? 0 : step / steps;
      drawRoadDisk(
        Math.round(startX + (endX - startX) * progress),
        Math.round(startY + (endY - startY) * progress),
        radius,
      );
    }
  }
}

function renderRoadTiles() {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!roadMask[indexOf(x, y)]) continue;
      const gid = bridgeMask[indexOf(x, y)]
        ? tuxemon("outdoor", 1288 + (hash(x, y, 19) % 2))
        : tuxemon("city", hash(x, y, 17) % 11 === 0 ? 1401 : 1201);
      setTile(terrain, x, y, gid);
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
  return tuxemon("water", hash(x, y, 11) % 18);
}

function applyWater() {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!isWater(x, y)) continue;
      setTile(terrain, x, y, waterTileAt(x, y));
      blockTile(x, y);
    }
  }
  const sandTiles = [64, 65, 66, 67, 68, 69];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (isWater(x, y) || roadMask[indexOf(x, y)]) continue;
      const touchesWater = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x - 1, y + 1],
        [x + 1, y + 1],
      ].some(([waterX, waterY]) => isWater(waterX, waterY));
      if (touchesWater) {
        setTile(
          terrain,
          x,
          y,
          tuxemon("water", sandTiles[hash(x, y, 23) % sandTiles.length]),
        );
      }
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
      bridgeMask[indexOf(x, y)] = 1;
      clearCollision(x, y);
    }
  }

  for (let x = startX; x <= endX; x += 1) {
    setTile(
      structures,
      x,
      startY - 1,
      tuxemon("outdoor", 978 + (hash(x, startY, 29) % 3)),
    );
    setTile(
      foreground,
      x,
      startY + height,
      tuxemon("outdoor", 978 + (hash(x, startY, 31) % 3)),
    );
    blockTile(x, startY - 1);
    blockTile(x, startY + height);
  }
}

function placeTree(x, y, variant = 0) {
  const pineStamps = [
    [
      [46, 47],
      [110, 111],
      [174, 175],
    ],
    [
      [48, 49],
      [112, 113],
      [176, 177],
    ],
    [
      [50, 51],
      [114, 115],
      [178, 179],
    ],
  ];
  if (
    !isInsideMap(x, y) ||
    !isInsideMap(x + 1, y - 2) ||
    isWater(x, y) ||
    isWater(x + 1, y) ||
    roadMask[indexOf(x, y)] ||
    roadMask[indexOf(x + 1, y)] ||
    collision[indexOf(x, y)] ||
    collision[indexOf(x + 1, y)]
  ) {
    return false;
  }
  const stamp = pineStamps[variant % pineStamps.length];
  for (let row = 0; row < stamp.length; row += 1) {
    for (let column = 0; column < stamp[row].length; column += 1) {
      setTile(
        row < stamp.length - 1 ? foreground : structures,
        x + column,
        y - 2 + row,
        tuxemon("nature", stamp[row][column]),
      );
    }
  }
  blockTile(x, y);
  blockTile(x + 1, y);
  return true;
}

function scatterTrees(x, y, width, height, density, salt) {
  for (let tileY = y + 3; tileY < y + height; tileY += 5) {
    for (let tileX = x + 1; tileX < x + width - 2; tileX += 4) {
      const candidateX = tileX + (hash(tileX, tileY, salt + 2) % 3) - 1;
      const candidateY = tileY + (hash(tileX, tileY, salt + 3) % 3) - 1;
      if (hash(candidateX, candidateY, salt) % 100 >= density) continue;
      placeTree(
        candidateX,
        candidateY,
        hash(candidateX, candidateY, salt + 1) % 3,
      );
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
  const shrubTiles = [1134, 1135, 1136, 1137];
  setTile(
    structures,
    x,
    y,
    tuxemon("outdoor", shrubTiles[hash(x, y, salt) % shrubTiles.length]),
  );
  blockTile(x, y);
  return true;
}

function placeFlower(x, y, salt) {
  if (
    !isInsideMap(x, y) ||
    isWater(x, y) ||
    roadMask[indexOf(x, y)] ||
    collision[indexOf(x, y)] ||
    structures[indexOf(x, y)]
  ) {
    return false;
  }
  const flowers = [
    ["outdoor", 953],
    ["outdoor", 954],
    ["outdoor", 955],
    ["outdoor", 990],
    ["outdoor", 991],
    ["outdoor", 992],
    ["outdoor", 1063],
    ["outdoor", 1064],
    ["outdoor", 1065],
    ["nature", 59],
    ["nature", 60],
    ["nature", 61],
    ["nature", 62],
    ["nature", 63],
  ];
  const [source, sourceIndex] = flowers[hash(x, y, salt) % flowers.length];
  setTile(structures, x, y, tuxemon(source, sourceIndex));
  return true;
}

function decorateLandscapeCluster(x, y, width, height, salt) {
  const grassTiles = [0, 1174, 1175, 1176];
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
      if (hash(tileX, tileY, salt) % 100 < 34) {
        setTile(
          ground,
          tileX,
          tileY,
          tuxemon(
            "city",
            grassTiles[hash(tileX, tileY, salt + 1) % grassTiles.length],
          ),
        );
      }
      if (hash(tileX, tileY, salt + 2) % 100 < 7) {
        placeFlower(tileX, tileY, salt + 3);
      }
    }
  }
  for (let tileY = y + 2; tileY < y + height - 1; tileY += 4) {
    for (let tileX = x + 2; tileX < x + width - 1; tileX += 4) {
      if (hash(tileX, tileY, salt + 4) % 100 < 24) {
        placeShrub(tileX, tileY, salt + 5);
      }
    }
  }
  for (let tileY = y + 3; tileY < y + height - 1; tileY += 7) {
    for (let tileX = x + 3; tileX < x + width - 1; tileX += 7) {
      if (hash(tileX, tileY, salt + 6) % 100 < 38) {
        placeTree(tileX, tileY, hash(tileX, tileY, salt + 7) % 3);
      }
    }
  }
}

function drawFenceRect(x, y, width, height, gateTiles = []) {
  const gates = new Set(gateTiles.map(([gateX, gateY]) => `${gateX},${gateY}`));
  for (let tileX = x; tileX < x + width; tileX += 1) {
    for (const tileY of [y, y + height - 1]) {
      if (gates.has(`${tileX},${tileY}`)) continue;
      setTile(
        structures,
        tileX,
        tileY,
        tuxemon("outdoor", 978 + (hash(tileX, tileY, 101) % 3)),
      );
      blockTile(tileX, tileY);
    }
  }
  for (let tileY = y + 1; tileY < y + height - 1; tileY += 1) {
    for (const tileX of [x, x + width - 1]) {
      if (gates.has(`${tileX},${tileY}`)) continue;
      setTile(
        structures,
        tileX,
        tileY,
        tuxemon("outdoor", 1015 + (hash(tileX, tileY, 102) % 3)),
      );
      blockTile(tileX, tileY);
    }
  }
}

function drawField(x, y, width, height, gateX, gateOnTop) {
  fillRect(terrain, x + 1, y + 1, width - 2, height - 2, (tileX, tileY) =>
    tuxemon("city", (tileX + tileY) % 7 === 0 ? 1401 : 1282),
  );
  const gateY = gateOnTop ? y : y + height - 1;
  drawFenceRect(x, y, width, height, [
    [gateX, gateY],
    [gateX + 1, gateY],
  ]);
  for (let tileY = y + 3; tileY < y + height - 2; tileY += 2) {
    for (let tileX = x + 3; tileX < x + width - 2; tileX += 2) {
      const crop = [1360, 1361, 1400][hash(tileX, tileY, 30) % 3];
      setTile(structures, tileX, tileY, tuxemon("city", crop));
    }
  }
}

function placeTownHouse(x, y, palette = "blue") {
  const rows =
    palette === "red"
      ? [
          [0, 12, 13, 14, 0],
          [51, 52, 53, 54, 55],
          [91, 92, 93, 94, 95],
          [131, 132, 133, 134, 135],
          [171, 172, 173, 174, 175],
        ]
      : [
          [0, 7, 8, 9, 0],
          [46, 47, 48, 49, 50],
          [86, 87, 88, 89, 90],
          [126, 127, 128, 129, 130],
          [166, 167, 168, 169, 170],
        ];
  rows.forEach((row, rowIndex) => {
    row.forEach((tile, columnIndex) => {
      if (!tile) return;
      setTile(
        rowIndex < 3 ? foreground : structures,
        x + columnIndex,
        y + rowIndex,
        tuxemon("city", tile),
      );
      blockTile(x + columnIndex, y + rowIndex);
    });
  });
  placeFlower(x, y + 5, x + y + 113);
  placeFlower(x + 4, y + 5, x + y + 127);
}

function placeBarn(x, y) {
  placeTownHouse(x, y, "red");
  const hayTiles = [1325, 1326, 1327, 1328, 1329, 1362, 1364, 1365, 1366, 1367, 1368];
  for (const [offsetX, offsetY] of [
    [6, 2],
    [7, 2],
    [6, 3],
    [7, 3],
  ]) {
    setTile(
      structures,
      x + offsetX,
      y + offsetY,
      tuxemon(
        "outdoor",
        hayTiles[hash(x + offsetX, y + offsetY, 131) % hayTiles.length],
      ),
    );
    blockTile(x + offsetX, y + offsetY);
  }
}

function placeFountain(x, y) {
  const rows = [
    [382, 383, 384],
    [422, 423, 424],
    [462, 463, 464],
  ];
  rows.forEach((row, rowIndex) => {
    row.forEach((sourceIndex, columnIndex) => {
      setTile(
        rowIndex === 0 ? foreground : structures,
        x + columnIndex,
        y + rowIndex,
        tuxemon("city", sourceIndex),
      );
      blockTile(x + columnIndex, y + rowIndex);
    });
  });
}

function placeBoulder(x, y, variant) {
  const stamps = [
    [
      [168, 169],
      [232, 233],
    ],
    [
      [170, 171],
      [234, 235],
    ],
  ];
  const stamp = stamps[variant % stamps.length];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      setTile(
        row === 0 ? foreground : structures,
        x + column,
        y + row,
        tuxemon("nature", stamp[row][column]),
      );
      blockTile(x + column, y + row);
    }
  }
}

function drawMountainEllipse(centerX, centerY, radiusX, radiusY, salt) {
  for (
    let scanY = centerY - radiusY;
    scanY <= centerY + radiusY;
    scanY += 3
  ) {
    for (
      let scanX = centerX - radiusX;
      scanX <= centerX + radiusX;
      scanX += 3
    ) {
      const x = scanX + (hash(scanX, scanY, salt + 1) % 2);
      const y = scanY + (hash(scanX, scanY, salt + 2) % 2);
      const normalized =
        ((x - centerX) * (x - centerX)) / (radiusX * radiusX) +
        ((y - centerY) * (y - centerY)) / (radiusY * radiusY);
      if (
        hash(x, y, salt + 3) % 100 >= 58 ||
        normalized > 1 ||
        !isInsideMap(x, y) ||
        !isInsideMap(x + 1, y + 1) ||
        isWater(x, y) ||
        roadMask[indexOf(x, y)] ||
        roadMask[indexOf(x + 1, y + 1)] ||
        collision[indexOf(x, y)] ||
        collision[indexOf(x + 1, y + 1)]
      ) {
        continue;
      }
      placeBoulder(x, y, hash(x, y, salt) % 2);
    }
  }
}

function placeSignVisual(x, y) {
  setTile(structures, x, y, tuxemon("nature", 53 + (hash(x, y, 137) % 6)));
  blockTile(x, y);
  setTile(encounter1, x, y, 0);
  setTile(encounter2, x, y, 0);
  setTile(encounter3, x, y, 0);
}

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const variation = hash(x, y, 3);
    if (variation % 67 === 0) {
      setTile(ground, x, y, tuxemon("city", 1174));
    } else if (variation % 89 === 0) {
      setTile(ground, x, y, tuxemon("city", 1175));
    } else if (variation % 113 === 0) {
      setTile(ground, x, y, tuxemon("city", 1176));
    }
  }
}

// Hand-drawn paths preserve the original macro connections while avoiding
// the previous ruler-straight road grid.
drawRoadPath(
  [
    [4, 126],
    [50, 124],
    [104, 127],
    [160, 123],
    [208, 126],
    [240, 126],
    [287, 124],
    [335, 126],
    [383, 123],
    [428, 127],
    [470, 126],
  ],
  3,
);
drawRoadPath(
  [
    [52, 10],
    [54, 40],
    [52, 78],
    [80, 81],
    [108, 80],
  ],
  3,
);
drawRoadPath(
  [
    [52, 80],
    [105, 81],
    [158, 78],
    [213, 82],
    [269, 79],
    [335, 80],
    [398, 78],
    [462, 80],
  ],
  5,
);
drawRoadPath(
  [
    [108, 78],
    [106, 113],
    [109, 151],
    [108, 185],
    [112, 208],
  ],
  3,
);
drawRoadPath(
  [
    [240, 20],
    [238, 66],
    [241, 108],
    [240, 126],
    [242, 165],
    [239, 207],
    [241, 227],
  ],
  3,
);
drawRoadPath(
  [
    [460, 74],
    [458, 112],
    [461, 151],
    [459, 188],
    [461, 208],
  ],
  3,
);
drawRoadPath(
  [
    [108, 186],
    [160, 184],
    [218, 187],
    [278, 184],
    [335, 186],
    [398, 183],
    [462, 186],
  ],
  5,
);
drawRoadPath([[60, 136], [108, 134], [158, 137]], 3);
drawRoadPath([[52, 206], [111, 208], [174, 204], [241, 207]], 3);

// A softened village loop frames the central square and joins the main spine.
drawRoadPath([[218, 116], [240, 117], [263, 116]], 3);
drawRoadPath([[218, 139], [241, 138], [264, 140]], 3);
drawRoadPath([[219, 116], [218, 128], [219, 140]], 3);
drawRoadPath([[262, 116], [264, 128], [263, 141]], 3);
drawRoadDisk(240, 126, 4);

// The eastern coast has an irregular sand-colored shoreline.
for (let y = 3; y < HEIGHT - 3; y += 1) {
  const shoreX = 472 + Math.round(Math.sin(y / 13) + Math.sin(y / 31));
  for (let x = shoreX - 6; x < shoreX; x += 1) {
    setTile(
      terrain,
      x,
      y,
      tuxemon("water", 64 + (hash(x, y, 37) % 6)),
    );
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
for (const [x, y] of [
  [161, 115],
  [164, 115],
  [168, 115],
  [173, 115],
  [178, 115],
]) {
  placeFlower(x, y, 149);
}

// The central village is a compact, non-enterable outdoor landmark.
placeTownHouse(214, 102, "blue");
placeTownHouse(232, 107, "red");
placeTownHouse(250, 108, "blue");
placeTownHouse(269, 102, "red");
placeTownHouse(224, 144, "red");
placeTownHouse(246, 145, "blue");
placeTownHouse(270, 144, "red");
placeTownHouse(279, 130, "blue");
placeFountain(243, 130);
for (const [x, y] of [
  [226, 122],
  [229, 121],
  [235, 122],
  [251, 124],
  [255, 132],
  [231, 134],
  [250, 136],
  [267, 133],
]) {
  placeFlower(x, y, 151);
}
placeTree(209, 115, 1);
placeTree(268, 115, 2);
placeTree(213, 140, 0);
placeTree(276, 140, 1);

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
decorateLandscapeCluster(96, 14, 39, 47, 85);
decorateLandscapeCluster(144, 28, 43, 40, 86);
decorateLandscapeCluster(193, 31, 36, 41, 87);
decorateLandscapeCluster(97, 84, 48, 28, 88);
decorateLandscapeCluster(153, 84, 47, 25, 89);
decorateLandscapeCluster(19, 116, 32, 37, 90);
decorateLandscapeCluster(72, 174, 29, 28, 91);
decorateLandscapeCluster(121, 173, 36, 31, 92);
decorateLandscapeCluster(158, 190, 37, 35, 93);
decorateLandscapeCluster(351, 84, 37, 42, 94);
decorateLandscapeCluster(397, 104, 48, 31, 95);

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
      columns: ATLAS_COLUMNS,
      firstgid: FIRST_GID.TUXEMON,
      image: "../images/tuxemon/tuxemon-valley-4x-extruded.png",
      imageheight: ATLAS_SIZE,
      imagewidth: ATLAS_SIZE,
      margin: ATLAS_MARGIN,
      name: "tuxemon-valley",
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

for (const [label, layer] of [
  ["Ground", ground],
  ["Terrain", terrain],
  ["Structures", structures],
  ["Foreground", foreground],
]) {
  if (
    layer.some(
      (gid) =>
        gid !== 0 &&
        (gid < FIRST_GID.TUXEMON || gid >= FIRST_GID.COLLISION),
    )
  ) {
    throw new Error(`${label} contains a GID outside the Tuxemon atlas.`);
  }
}
if (collision.some((gid) => gid !== 0 && gid !== FIRST_GID.COLLISION)) {
  throw new Error("Collision contains an unexpected GID.");
}
for (const [label, layer] of [
  ["Encounter-Area-1", encounter1],
  ["Encounter-Area-2", encounter2],
  ["Encounter-Area-3", encounter3],
]) {
  if (layer.some((gid) => gid !== 0 && gid !== FIRST_GID.ENCOUNTER)) {
    throw new Error(`${label} contains an unexpected GID.`);
  }
}

const sourceImages = new Map();
for (const [source, definition] of Object.entries(SOURCE_DEFINITIONS)) {
  const sourcePath = path.join(SOURCE_ROOT, definition.file);
  const sourceBytes = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sha256 !== definition.sha256) {
    throw new Error(
      `Tuxemon source hash mismatch for ${definition.file}: ${sha256}.`,
    );
  }
  const {
    data,
    info: { width, height, channels },
  } = await sharp(sourceBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    width !== definition.width ||
    height !== definition.height ||
    channels !== 4
  ) {
    throw new Error(
      `Unexpected Tuxemon source geometry for ${definition.file}: ${width}x${height}x${channels}.`,
    );
  }
  sourceImages.set(source, { data, width, height, channels });
}

const atlasPixels = Buffer.alloc(ATLAS_SIZE * ATLAS_SIZE * 4);
const copyPixel = (from, fromOffset, to, toOffset) => {
  from.copy(to, toOffset, fromOffset, fromOffset + 4);
};
TUXEMON_TILE_MANIFEST.forEach(({ source, sourceIndex }, slot) => {
  const definition = SOURCE_DEFINITIONS[source];
  const sourceImage = sourceImages.get(source);
  const sourceX = (sourceIndex % definition.columns) * SOURCE_TILE_SIZE;
  const sourceY =
    Math.floor(sourceIndex / definition.columns) * SOURCE_TILE_SIZE;
  if (
    sourceX + SOURCE_TILE_SIZE > sourceImage.width ||
    sourceY + SOURCE_TILE_SIZE > sourceImage.height
  ) {
    throw new Error(`Tuxemon source tile is out of range: ${source}:${sourceIndex}.`);
  }
  let opaquePixelCount = 0;
  const destinationX = (slot % ATLAS_COLUMNS) * ATLAS_CELL_SIZE;
  const destinationY = Math.floor(slot / ATLAS_COLUMNS) * ATLAS_CELL_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const sampledX = sourceX + Math.floor(x / 4);
      const sampledY = sourceY + Math.floor(y / 4);
      const sourceOffset =
        (sampledY * sourceImage.width + sampledX) * sourceImage.channels;
      const destinationOffset =
        ((destinationY + ATLAS_MARGIN + y) * ATLAS_SIZE +
          destinationX +
          ATLAS_MARGIN +
          x) *
        4;
      copyPixel(sourceImage.data, sourceOffset, atlasPixels, destinationOffset);
      if (sourceImage.data[sourceOffset + 3] !== 0) opaquePixelCount += 1;
    }
  }
  if (opaquePixelCount === 0) {
    throw new Error(`Tuxemon source tile is fully transparent: ${source}:${sourceIndex}.`);
  }
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const row = destinationY + ATLAS_MARGIN + y;
    const leftInteriorOffset =
      (row * ATLAS_SIZE + destinationX + ATLAS_MARGIN) * 4;
    const rightInteriorOffset =
      (row * ATLAS_SIZE + destinationX + ATLAS_MARGIN + TILE_SIZE - 1) * 4;
    copyPixel(
      atlasPixels,
      leftInteriorOffset,
      atlasPixels,
      (row * ATLAS_SIZE + destinationX) * 4,
    );
    copyPixel(
      atlasPixels,
      rightInteriorOffset,
      atlasPixels,
      (row * ATLAS_SIZE + destinationX + ATLAS_CELL_SIZE - 1) * 4,
    );
  }
  const firstInteriorRow =
    ((destinationY + ATLAS_MARGIN) * ATLAS_SIZE + destinationX) * 4;
  const lastInteriorRow =
    ((destinationY + ATLAS_MARGIN + TILE_SIZE - 1) * ATLAS_SIZE +
      destinationX) *
    4;
  atlasPixels.copy(
    atlasPixels,
    (destinationY * ATLAS_SIZE + destinationX) * 4,
    firstInteriorRow,
    firstInteriorRow + ATLAS_CELL_SIZE * 4,
  );
  atlasPixels.copy(
    atlasPixels,
    ((destinationY + ATLAS_CELL_SIZE - 1) * ATLAS_SIZE + destinationX) * 4,
    lastInteriorRow,
    lastInteriorRow + ATLAS_CELL_SIZE * 4,
  );
});

await mkdir(RUNTIME_IMAGE_ROOT, { recursive: true });
await sharp(atlasPixels, {
  raw: {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    channels: 4,
  },
})
  .png({ compressionLevel: 9, palette: true })
  .toFile(RUNTIME_ATLAS_PATH);
await writeFile(MAP_PATH, `${JSON.stringify(map)}\n`);

console.log(
  `Generated main_1 (${WIDTH}x${HEIGHT}, ${TILE_SIZE}px tiles), 1 curated Tuxemon atlas (${TUXEMON_TILE_MANIFEST.length}/256 populated slots), 10 NPCs, 6 items, 9 signs, and 3 encounter areas.`,
);
