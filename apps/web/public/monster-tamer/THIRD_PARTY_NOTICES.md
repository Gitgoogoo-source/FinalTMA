# Third-Party Notices

This directory contains a self-contained integration of Monster Tamer. The
game does not use the FinalTMA application state, APIs, database, balances, or
inventory.

## Monster Tamer source

- Project: `devshareacademy/monster-tamer`
- Source commit: `a964bba7ca0ae1aeeb712065a01b09ce3366f395`
- Source: <https://github.com/devshareacademy/monster-tamer>
- License: MIT
- Copyright: Copyright (c) 2024 Dev Share Academy
- Full license text: `LICENSE`

The mobile touch adapter, host return controls, layout styles, local vendor
loading, storage-failure handling, music delivery format, and cleared original
visuals are integration changes made for this project. The game functionality
from the source commit is otherwise retained.

## Runtime libraries

### Phaser 3.60.0

- Distribution: <https://www.npmjs.com/package/phaser/v/3.60.0>
- Local file: `vendor/phaser-3.60.0.min.js`
- SHA-256: `d16aca3f36470e2d1eac3a37ba708261e2a496bfad896f8c0172597df42f3455`
- License text: `vendor/licenses/PHASER-LICENSE.md`

### Web Font Loader 1.6.28

- Distribution: <https://www.npmjs.com/package/webfontloader/v/1.6.28>
- Local file: `vendor/webfontloader-1.6.28.min.js`
- SHA-256: `e0ee294b5487df566aad23b603fd902535634cfa957be8e7620396515afb1047`
- License text: `vendor/licenses/WEBFONTLOADER-LICENSE`

### Tweakpane 4.0.3

- Distribution: <https://www.npmjs.com/package/tweakpane/v/4.0.3>
- Local file: `vendor/tweakpane-4.0.3.min.js`
- SHA-256: `f3a01f6fb09507a39c59b74f8430b16a7b2bbb67665aadc6c3efc2ec99ce1eae`
- License text: `vendor/licenses/TWEAKPANE-LICENSE.txt`

## Upstream game asset archive

- Archive source:
  <https://github.com/devshareacademy/monster-tamer/releases/download/assets/all-game-assets-v2.zip>
- Archive SHA-256:
  `bacc953ea8a91130e99bf8f82cb428263cc0223c99d550a271892ada394e5110`

The archive was used only to reconstruct the fixed upstream runtime and audit
its asset sources. A credit in an upstream README was not treated as license
clearance. Every retained third-party file belongs to one of the cleared groups
below; all upstream raster files lacking direct evidence were replaced.

## Tuxemon valley map art

The seamless `main_1` valley uses only the audited tiles selected from the four
Tuxemon source sheets below. The audit is pinned to repository commit
`c34a9c727129999671e4206ade7425cbb45745b4`; each selected source sheet is
identified by path and SHA-256 so that its attribution and license evidence can
be reproduced exactly.

| Source sheet | SHA-256 |
| --- | --- |
| `mods/tuxemon/gfx/tilesets/core_outdoor.png` | `a3b62b7113408450f6af3c8d86ef287fe78cabd1bb7b9580414bcace4d90ff08` |
| `mods/tuxemon/gfx/tilesets/core_outdoor_nature.png` | `c1c58c5115c35a730743c4e0bd9b48c05b77d38f1873d16216b924f9a33712aa` |
| `mods/tuxemon/gfx/tilesets/core_outdoor_water.png` | `571fc2ad3a648424da78fb9d1abfe9027b7a9a6ef39e8f2b4d28e0eb2e3cc2f6` |
| `mods/tuxemon/gfx/tilesets/core_city_and_country.png` | `1cdf4a534a7e3078f3d18022c690022582b3a84cfefef4f7d02c739872b39178` |

- Project: Tuxemon
- Repository: <https://github.com/Tuxemon/Tuxemon>
- License for the selected sheets: Creative Commons
  Attribution-ShareAlike 4.0
- Upstream attribution record:
  <https://github.com/Tuxemon/Tuxemon/blob/c34a9c727129999671e4206ade7425cbb45745b4/ATTRIBUTIONS.md#L332-L470>
- Checked build sources:
  `assets/source/monster-tamer/tuxemon/c34a9c727129999671e4206ade7425cbb45745b4/`
- Runtime atlas:
  `assets/images/tuxemon/tuxemon-valley-4x-extruded.png`
- Published source record: `assets/licenses/tuxemon/SOURCE.json`
- Published attribution record: `assets/licenses/tuxemon/ATTRIBUTIONS.md`
- Published license text: `assets/licenses/tuxemon/CC-BY-SA-4.0.txt`

The runtime atlas contains only the selected map tiles. The integration
selected and repacked those tiles into one compact 16×16-slot atlas, enlarged
each 16×16 tile to 64×64 with nearest-neighbor resampling, and added one pixel
of copied-edge extrusion per slot. The four complete source sheets are
build-time audit inputs and are not runtime assets; the browser loads only the
single 1056×1056 compact atlas.

The compact atlas and the `main_1` visual tile layers are adaptations
distributed under CC BY-SA 4.0. Tuxemon source code, TMX maps, TSX tileset
definitions, existing map layouts, and tiles with non-commercial, purchased,
XYG, mixed, or unresolved provenance were not copied. The FinalTMA and Monster
Tamer application code remains separately licensed and is not relicensed by
this artwork notice.

## Retained third-party assets

### Kenney

- Creator: Kenney
- Assets: Kenney Future Narrow font, UI Pack, UI Pack Space Expansion
- License: Creative Commons Zero 1.0
- Evidence:
  - `assets/fonts/kenneys-fonts/License.txt`
  - `assets/images/kenneys-assets/ui-pack/license.txt`
  - `assets/images/kenneys-assets/ui-space-expansion/license.txt`
- Source:
  - <https://www.kenney.nl/assets/kenney-fonts>
  - <https://www.kenney.nl/assets/ui-pack>
  - <https://www.kenney.nl/assets/ui-pack-space-expansion>

### AxulArt / AlexDreamer

- Assets:
  - `assets/images/axulart/character/custom.png`
  - `assets/images/axulart/beach/crushed.png`
- Character license: Creative Commons Attribution-ShareAlike 4.0, including
  commercial use and modification with credit; the local evidence states the
  stricter ShareAlike terms and no standalone resale or redistribution.
- Beach tileset license: Creative Commons Attribution 4.0 on its source page.
- Credit: AlexDreamer / AxulArt
- Evidence and source:
  - `assets/images/axulart/character/license.txt`
  - <https://axulart.itch.io/small-8-direction-characters>
  - <https://axulart.itch.io/axularts-beach-and-caves-tileset>
- Integration modification: the retained character and beach sheets are the
  scaled and packed variants distributed with the upstream game archive.

### Pimen

- Assets:
  - `assets/images/pimen/ice-attack/start.png`
  - `assets/images/pimen/ice-attack/active.png`
  - `assets/images/pimen/slash.png`
- Terms on the source pages permit personal and commercial project use and
  modification, and prohibit redistribution as standalone assets.
- Credit: Pimen
- Source:
  - <https://pimen.itch.io/ice-spell-effect-01>
  - <https://pimen.itch.io/battle-vfx-slashes-and-thrusts>
- Integration modification: the retained sheets are the packed variants
  distributed with the upstream game archive.

### The Pixel Nook / Parabellum Games

- Asset: `assets/images/parabellum-games/characters.png`
- License: Creative Commons Attribution 4.0 on the creator's source page.
- Credit: The Pixel Nook / Parabellum Games
- Evidence and source:
  - `assets/images/parabellum-games/notes.txt`
  - <https://parabellum-games.itch.io/retro-rpg-character-pack>
- Integration modification: the retained character sheet is the packed variant
  distributed with the upstream game archive.

### xDeviruchi

- Assets:
  - `assets/audio/xDeviruchi/And-the-Journey-Begins.mp3`
  - `assets/audio/xDeviruchi/Decisive-Battle.mp3`
  - `assets/audio/xDeviruchi/Title-Theme.mp3`
- License: Creative Commons Attribution-ShareAlike 4.0.
- Credit: xDeviruchi
- Evidence: `assets/audio/xDeviruchi/READ THIS FIRST.pdf`
- Source: <https://soundcloud.com/xdeviruchi>
- Integration modification: the three WAV files were format-shifted to 160
  kbit/s MP3 for mobile delivery. Their music content and gameplay roles are
  unchanged. The converted files remain under CC BY-SA 4.0.

### leohpaz

- Assets:
  - `assets/audio/leohpaz/03_Step_grass_03.wav`
  - `assets/audio/leohpaz/51_Flee_02.wav`
  - `assets/audio/leohpaz/13_Ice_explosion_01.wav`
  - `assets/audio/leohpaz/03_Claw_03.wav`
- Terms permit use in projects and prohibit redistribution of the asset pack as
  a standalone product.
- Credit: leohpaz
- Evidence: `assets/audio/leohpaz/liscense.png`
- Source: <https://leohpaz.itch.io/rpg-essentials-sfx-free>

## Project-original visual assets

The monster portraits, title landscape, battle landscape, and two trainer
illustrations were created from text-only prompts without an upstream image
reference. Original UI, capture items, hidden collision/encounter tiles, and
the favicon are generated by
`tools/monster-tamer/generate-original-assets.mjs`.

The valley map is generated by
`tools/monster-tamer/generate-valley-map.mjs` from the audited Tuxemon tiles
documented above. Only one compact derivative atlas is loaded at runtime; the
complete source sheets are retained solely as build-time provenance. No
uncleared upstream Monster Tamer raster remains in the published tree. See
`ORIGINAL_ASSET_PROVENANCE.md` for the project-original prompt and output
record.
