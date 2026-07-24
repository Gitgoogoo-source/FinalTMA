#!/usr/bin/env node

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = resolve(ROOT, "assets/source/catalog/v1");
const OUTPUT = resolve(ROOT, "apps/web/public/assets/catalog/v1");
const MANIFEST = resolve(ROOT, "generated/catalog/catalog-v1.json");
const VARIANTS = {
  thumb: { width: 256, quality: 82, maxBytes: 50 * 1024 },
  detail: { width: 768, quality: 74, maxBytes: 180 * 1024 },
};

const catalog = JSON.parse(await readFile(MANIFEST, "utf8"));
const names =
  catalog.templates?.map(({ id }) => `${String(id).toLowerCase()}.webp`) ?? [];
if (names.length !== 210 || new Set(names).size !== 210)
  throw new Error("Catalog manifest must contain exactly 210 unique templates");

const sourceNames = (await readdir(SOURCE)).filter(
  (name) => !name.startsWith("."),
);
const missing = names.filter((name) => !sourceNames.includes(name));
const extra = sourceNames.filter((name) => !names.includes(name));
if (missing.length || extra.length)
  throw new Error(
    `Catalog source mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`,
  );

for (const variant of Object.keys(VARIANTS)) {
  await rm(resolve(OUTPUT, variant), { recursive: true, force: true });
  await mkdir(resolve(OUTPUT, variant), { recursive: true });
}

sharp.concurrency(4);

async function generate(name) {
  const source = resolve(SOURCE, name);
  const metadata = await sharp(source).metadata();
  if (
    metadata.format !== "webp" ||
    metadata.width !== 768 ||
    metadata.height !== 768 ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error(`${name} must be a single-frame 768x768 WebP source`);
  await Promise.all(
    Object.entries(VARIANTS).map(async ([variant, config]) => {
      const info = await sharp(source)
        .resize(config.width, config.width, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
        })
        .webp({ quality: config.quality, effort: 6, alphaQuality: 100 })
        .toFile(resolve(OUTPUT, variant, name));
      if (
        info.format !== "webp" ||
        info.width !== config.width ||
        info.height !== config.width ||
        info.size > config.maxBytes
      )
        throw new Error(
          `${variant}/${name} violates its format, dimensions, or ${config.maxBytes}-byte budget`,
        );
    }),
  );
}

for (let index = 0; index < names.length; index += 8)
  await Promise.all(names.slice(index, index + 8).map(generate));

console.log(
  `generated ${names.length * 2} catalog assets from ${names.length} formal masters`,
);
