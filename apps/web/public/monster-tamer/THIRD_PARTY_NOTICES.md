# Third-Party Notices

This directory contains the read-only Phaser renderer used by FinalTMA's
Monster Tamer collection home. The authenticated React parent owns inventory
queries and injects only the minimal display payload. The renderer does not
call FinalTMA APIs or write business state.

## Monster Tamer source

- Project: `devshareacademy/monster-tamer`
- Source commit: `a964bba7ca0ae1aeeb712065a01b09ce3366f395`
- Source: <https://github.com/devshareacademy/monster-tamer>
- License: MIT
- Copyright: Copyright (c) 2024 Dev Share Academy
- Full license text: `LICENSE`

The original exploration, player, NPC, encounter, battle, capture, party,
inventory, item, dialog, audio, and local-state systems are not shipped. The
remaining integration keeps the locally hosted Phaser boundary and replaces
the game runtime with project-authored collection-home code.

## Phaser 3.60.0

- Distribution: <https://www.npmjs.com/package/phaser/v/3.60.0>
- Local file: `vendor/phaser-3.60.0.min.js`
- SHA-256: `d16aca3f36470e2d1eac3a37ba708261e2a496bfad896f8c0172597df42f3455`
- License text: `vendor/licenses/PHASER-LICENSE.md`

Web Font Loader and Tweakpane are no longer used or distributed.

## Tiny Swords free-pack map art

The 50×50 water home uses a strict 32-file selection from the free Tiny
Swords asset pack:

- Creator: Pixel Frog
- Project: Tiny Swords (Free Pack)
- Source: <https://pixelfrog-assets.itch.io/tiny-swords>
- Tilemap guide:
  <https://pixelfrog-assets.itch.io/tiny-swords/devlog/1138989/tilemap-guide>
- Terms captured: 2026-07-25
- Checked build sources:
  `assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/`
- Published source record: `assets/licenses/tiny-swords/SOURCE.json`
- Published terms record: `assets/licenses/tiny-swords/TERMS.md`
- Runtime terrain atlas:
  `assets/images/tiny-swords/tiny-swords-terrain-extruded.png`

The selected source set contains `Tilemap_color1`, the solid `#47ABA9` water
background, water foam, terrain shadow, four trees, four stumps, four bushes,
four ground rocks, four animated water rocks, and all eight Blue Buildings.
Every path, source dimension, and SHA-256 is recorded in `SOURCE.json`.

Units, people, animals, sheep, gatherable resources, tools, Particle FX, UI
Elements, Clouds, Rubber Duck, Aseprite files, alternate building colors, and
the Enemy Pack are excluded. The map generator extracts only the nine used
64×64 grass-island tiles and packs them into the existing copied-edge atlas
format. Buildings and allowed environment strips retain their source pixels
and normalized local paths.

The source page permits personal and commercial project use and modification.
Pixel Frog is credited here. The captured source terms prohibit
redistributing, reselling, or repackaging the assets as an asset pack. The
selected files are published only as components of this game.

## FinalTMA catalog images

Pet entities use FinalTMA Catalog v1 images from
`/assets/catalog/v1/thumb/`. The collection detail overlay uses the
corresponding `/assets/catalog/v1/detail/` image. Monster Tamer does not ship
a second pet image set or generate directional and battle frames.

## Project-authored runtime

`tools/monster-tamer/generate-island-map.mjs` generates the 50×50 island,
collision data, scenery placement, runtime atlas, and source-evidence copies.
`src/scenes/pet-home-scene.js` implements read-only pet rendering, collision
aware roaming, camera movement, and the parent click bridge.
