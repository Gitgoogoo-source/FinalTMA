import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const GAME_ROOT = path.join(ROOT, "apps/web/public/monster-tamer");
const IMAGE_ROOT = path.join(GAME_ROOT, "assets/images/monster-tamer");
const TILE = 64;

async function renderSvg(
  relativePath,
  width,
  height,
  content,
  background = "transparent",
) {
  const output = path.join(IMAGE_ROOT, relativePath);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${background}"/>
      ${content}
    </svg>
  `;
  await sharp(Buffer.from(svg))
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function renderBushes() {
  const frames = [];
  const offsets = [-5, 4, -2, 6];
  for (let frame = 0; frame < 4; frame += 1) {
    const x = (frame % 2) * TILE;
    const y = Math.floor(frame / 2) * TILE;
    const sway = offsets[frame];
    frames.push(`
      <path d="M${x + 4} ${y + 62} Q${x + 12 + sway} ${y + 18} ${x + 25} ${y + 60}
        Q${x + 34 + sway} ${y + 10} ${x + 43} ${y + 60}
        Q${x + 53 + sway} ${y + 24} ${x + 61} ${y + 62} Z"
        fill="#2f7548" stroke="#194b34" stroke-width="4"/>
      <path d="M${x + 15} ${y + 50} Q${x + 28 + sway} ${y + 25} ${x + 39} ${y + 52}"
        fill="none" stroke="#55a65d" stroke-width="5" stroke-linecap="round"/>
    `);
  }
  await renderSvg("map/bushes.png", 128, 128, frames.join(""));
}

async function renderUi() {
  await renderSvg(
    "ui/cursor.png",
    7,
    11,
    '<path d="M0 0 L7 5.5 L0 11 Z" fill="#efb84b"/><path d="M1 3 L4.5 5.5 L1 8 Z" fill="#fff2b6"/>',
  );
  await renderSvg(
    "ui/cursor_white.png",
    7,
    11,
    '<path d="M0 0 L7 5.5 L0 11 Z" fill="#ffffff"/><path d="M1 3 L4.5 5.5 L1 8 Z" fill="#8dd8d2"/>',
  );
  await renderSvg(
    "ui/title/title_background.png",
    2048,
    2048,
    `
      <defs>
        <radialGradient id="panel" cx="50%" cy="42%" r="65%">
          <stop offset="0" stop-color="#2b7775" stop-opacity=".94"/>
          <stop offset=".68" stop-color="#123c47" stop-opacity=".9"/>
          <stop offset="1" stop-color="#071b24" stop-opacity=".76"/>
        </radialGradient>
      </defs>
      <circle cx="1024" cy="1024" r="860" fill="url(#panel)" stroke="#e0b964" stroke-width="56"/>
      <circle cx="1024" cy="1024" r="735" fill="none" stroke="#73d5c6" stroke-width="18" stroke-dasharray="42 28"/>
      <path d="M1024 210 L1105 430 L1345 454 L1160 608 L1214 846 L1024 720 L834 846 L888 608 L703 454 L943 430 Z"
        fill="#e0b964" fill-opacity=".22" stroke="#f3d58c" stroke-width="18"/>
    `,
  );
  await renderSvg(
    "ui/title/title_text.png",
    694,
    109,
    `
      <defs>
        <linearGradient id="title" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#fff0a9"/>
          <stop offset=".52" stop-color="#efbb4f"/>
          <stop offset="1" stop-color="#b76531"/>
        </linearGradient>
      </defs>
      <text x="347" y="80" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="66"
        font-weight="900" letter-spacing="2" fill="#102f39" stroke="#102f39" stroke-width="13">MONSTER TAMER</text>
      <text x="347" y="80" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="66"
        font-weight="900" letter-spacing="2" fill="url(#title)" stroke="#fff2bd" stroke-width="3">MONSTER TAMER</text>
    `,
  );
  await renderSvg(
    "ui/monster-party/background.png",
    32,
    32,
    `
      <rect width="32" height="32" fill="#163d49"/>
      <path d="M0 16 H32 M16 0 V32" stroke="#245967" stroke-width="2"/>
      <circle cx="16" cy="16" r="5" fill="none" stroke="#62b9aa" stroke-width="2"/>
    `,
  );
  await renderSvg(
    "ui/monster-party/monster-details-background.png",
    1024,
    576,
    `
      <defs>
        <linearGradient id="details" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#102f3c"/>
          <stop offset="1" stop-color="#2e5a55"/>
        </linearGradient>
      </defs>
      <rect x="24" y="24" width="976" height="528" rx="34" fill="url(#details)" stroke="#d8bd79" stroke-width="8"/>
      <circle cx="205" cy="288" r="145" fill="#173f4c" stroke="#63bcae" stroke-width="8"/>
      <path d="M400 150 H900 M400 220 H820 M400 290 H920 M400 430 H750" stroke="#78a59b" stroke-width="18"
        stroke-linecap="round" opacity=".35"/>
    `,
  );
  await renderSvg(
    "ui/inventory/bag_background.png",
    1024,
    576,
    `
      <defs>
        <linearGradient id="bagbg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#3e2f31"/>
          <stop offset=".52" stop-color="#73513d"/>
          <stop offset="1" stop-color="#263f43"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="576" fill="url(#bagbg)"/>
      <path d="M0 90 H1024 M0 486 H1024" stroke="#e2bd72" stroke-width="5" opacity=".55"/>
      <circle cx="880" cy="112" r="62" fill="none" stroke="#72c3b3" stroke-width="12" opacity=".5"/>
      <path d="M70 170 H650 M70 250 H590 M70 330 H690 M70 410 H530" stroke="#f4dfad" stroke-width="24"
        stroke-linecap="round" opacity=".14"/>
    `,
  );
  await renderSvg(
    "ui/inventory/bag.png",
    512,
    512,
    `
      <path d="M142 170 Q160 58 256 58 Q352 58 370 170" fill="none" stroke="#d7ad63" stroke-width="38"
        stroke-linecap="round"/>
      <path d="M90 180 Q256 120 422 180 L454 434 Q256 488 58 434 Z" fill="#8c5236" stroke="#3a2928"
        stroke-width="18"/>
      <path d="M76 245 Q256 310 436 245" fill="none" stroke="#d5a35b" stroke-width="18"/>
      <rect x="212" y="230" width="88" height="92" rx="16" fill="#d7ad63" stroke="#3a2928" stroke-width="14"/>
      <circle cx="256" cy="276" r="17" fill="#2b7775"/>
      <path d="M118 382 Q256 430 394 382" fill="none" stroke="#663a2e" stroke-width="14"/>
    `,
  );
}

async function renderBattleItems() {
  const orb = `
    <circle cx="16" cy="16" r="14" fill="#173f49" stroke="#0b2027" stroke-width="3"/>
    <path d="M3 16 H29" stroke="#e0b85d" stroke-width="4"/>
    <path d="M7 10 Q16 2 25 10" fill="#55b9aa" stroke="#d9f2df" stroke-width="2"/>
    <circle cx="16" cy="16" r="5" fill="#f7e4a4" stroke="#0b2027" stroke-width="2"/>
  `;
  await renderSvg("battle/cosmoball.png", 32, 32, orb);
  await renderSvg(
    "battle/damagedBall.png",
    512,
    512,
    `
      <circle cx="256" cy="256" r="218" fill="#173f49" stroke="#081b21" stroke-width="28"/>
      <path d="M46 256 H466" stroke="#d7a94e" stroke-width="54"/>
      <path d="M94 176 Q256 34 418 176" fill="#48aa9b" stroke="#d9f2df" stroke-width="22"/>
      <circle cx="256" cy="256" r="74" fill="#f6dfa0" stroke="#081b21" stroke-width="24"/>
      <path d="M300 52 L257 154 L323 197 L270 276 L324 334 L281 459" fill="none" stroke="#081b21"
        stroke-width="30" stroke-linejoin="round"/>
      <path d="M280 194 L230 219 M299 333 L358 359" fill="none" stroke="#081b21" stroke-width="22"/>
    `,
  );
}

async function renderHiddenTiles() {
  await renderSvg(
    "map/collision.png",
    64,
    64,
    '<rect width="64" height="64" fill="#ff3355" fill-opacity=".01"/>',
  );
  await renderSvg(
    "map/encounter.png",
    64,
    64,
    '<rect width="64" height="64" fill="#33ffaa" fill-opacity=".01"/>',
  );
}

async function renderFavicon() {
  const png = await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill="#102e38"/>
        <circle cx="32" cy="32" r="23" fill="#26756e" stroke="#f1ca6e" stroke-width="5"/>
        <path d="M10 32 H54" stroke="#f1ca6e" stroke-width="7"/>
        <circle cx="32" cy="32" r="8" fill="#fff0b2" stroke="#102e38" stroke-width="4"/>
      </svg>
    `),
  )
    .png()
    .toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(64, 6);
  header.writeUInt8(64, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile(
    path.join(GAME_ROOT, "favicon.ico"),
    Buffer.concat([header, png]),
  );
}

await Promise.all([
  renderBushes(),
  renderUi(),
  renderBattleItems(),
  renderHiddenTiles(),
  renderFavicon(),
]);

console.log(
  "Generated original Monster Tamer UI, battle items, hidden tiles, and favicon.",
);
