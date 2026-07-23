import Phaser from "phaser";

import { AREA_DEFINITIONS, MONSTER_TAMER_TILE_SIZE } from "../content/areas.ts";

export const WORLD_TILESET_TEXTURE_KEY = "monster-tamer-world-tiles";
export const PLAYER_TEXTURE_KEY = "monster-tamer-player";
export const PARTICLE_TEXTURE_KEY = "monster-tamer-particle";

export function ensureProceduralTextures(scene: Phaser.Scene): void {
  ensureWorldTileset(scene);
  ensurePlayer(scene);
  ensureParticle(scene);
}

function ensureWorldTileset(scene: Phaser.Scene): void {
  if (scene.textures.exists(WORLD_TILESET_TEXTURE_KEY)) return;

  const definitions = Object.values(AREA_DEFINITIONS);
  const canvas = scene.textures.createCanvas(
    WORLD_TILESET_TEXTURE_KEY,
    definitions.length * 4 * MONSTER_TAMER_TILE_SIZE,
    MONSTER_TAMER_TILE_SIZE,
  );
  if (!canvas) throw new Error("Unable to create Monster Tamer world tiles.");
  const context = canvas.getContext();
  context.imageSmoothingEnabled = false;

  definitions.forEach((definition, areaIndex) => {
    for (let variant = 0; variant < 4; variant += 1) {
      const tileIndex = areaIndex * 4 + variant;
      drawGroundTile(
        context,
        tileIndex * MONSTER_TAMER_TILE_SIZE,
        definition.palette.base,
        definition.palette.patch,
        definition.palette.path,
        definition.palette.accent,
        variant,
        definition.seed,
      );
    }
  });

  canvas.refresh();
}

function ensurePlayer(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLAYER_TEXTURE_KEY)) return;

  const canvas = scene.textures.createCanvas(PLAYER_TEXTURE_KEY, 48, 64);
  if (!canvas) throw new Error("Unable to create Monster Tamer player.");
  const context = canvas.getContext();
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, 48, 64);

  context.fillStyle = "#263a50";
  context.fillRect(12, 8, 24, 8);
  context.fillRect(8, 16, 32, 16);
  context.fillStyle = "#f7cf9d";
  context.fillRect(14, 17, 20, 14);
  context.fillStyle = "#18324f";
  context.fillRect(16, 22, 4, 4);
  context.fillRect(28, 22, 4, 4);
  context.fillStyle = "#ffda4d";
  context.fillRect(8, 8, 32, 6);

  context.fillStyle = "#f5f3e8";
  context.fillRect(10, 32, 28, 19);
  context.fillStyle = "#37a5dd";
  context.fillRect(8, 36, 9, 16);
  context.fillRect(31, 36, 9, 16);
  context.fillStyle = "#f25f5c";
  context.fillRect(18, 32, 12, 6);
  context.fillStyle = "#263a50";
  context.fillRect(12, 51, 9, 9);
  context.fillRect(27, 51, 9, 9);
  context.fillStyle = "#ffffff";
  context.fillRect(14, 51, 5, 3);
  context.fillRect(29, 51, 5, 3);

  canvas.refresh();
}

function ensureParticle(scene: Phaser.Scene): void {
  if (scene.textures.exists(PARTICLE_TEXTURE_KEY)) return;

  const graphics = scene.make.graphics({ x: 0, y: 0 });
  graphics.fillStyle(0xffffff, 1);
  graphics.fillRect(3, 0, 6, 12);
  graphics.fillRect(0, 3, 12, 6);
  graphics.generateTexture(PARTICLE_TEXTURE_KEY, 12, 12);
  graphics.destroy();
}

function drawGroundTile(
  context: CanvasRenderingContext2D,
  originX: number,
  base: number,
  patch: number,
  path: number,
  accent: number,
  variant: number,
  seed: number,
): void {
  context.fillStyle = color(base);
  context.fillRect(
    originX,
    0,
    MONSTER_TAMER_TILE_SIZE,
    MONSTER_TAMER_TILE_SIZE,
  );

  const colors = [patch, lighten(base, 0.08), path, accent];
  const squareCount = variant === 0 ? 6 : variant === 1 ? 10 : 8;
  for (let index = 0; index < squareCount; index += 1) {
    const value = pseudo(seed + variant * 97 + index * 31);
    const x = Math.floor((value * 7 + index * 3) % 8) * 8;
    const y = Math.floor((value * 13 + index * 5) % 8) * 8;
    const chosen = colors[(index + variant) % colors.length] ?? patch;
    context.globalAlpha = variant === 3 ? 0.16 : 0.1 + (index % 3) * 0.03;
    context.fillStyle = color(chosen);
    context.fillRect(originX + x, y, variant === 2 ? 16 : 8, 8);
  }

  context.globalAlpha = 0.12;
  context.strokeStyle = color(lighten(base, 0.12));
  context.lineWidth = 2;
  context.strokeRect(
    originX + 1,
    1,
    MONSTER_TAMER_TILE_SIZE - 2,
    MONSTER_TAMER_TILE_SIZE - 2,
  );
  context.globalAlpha = 1;
}

function color(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function lighten(value: number, amount: number): number {
  const red = Math.min(255, ((value >> 16) & 0xff) + 255 * amount);
  const green = Math.min(255, ((value >> 8) & 0xff) + 255 * amount);
  const blue = Math.min(255, (value & 0xff) + 255 * amount);
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}

function pseudo(value: number): number {
  const sine = Math.sin(value * 12.9898) * 43758.5453;
  return sine - Math.floor(sine);
}
