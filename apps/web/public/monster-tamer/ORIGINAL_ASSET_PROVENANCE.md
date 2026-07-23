# Original Asset Provenance

The files listed here were created specifically for this FinalTMA integration.
No upstream Monster Tamer image was supplied as an image-generation reference.

## Generated illustrations

The following normalized prompts describe the project-original image-generation
requests. The generated working files are retained in the Codex artifact
directory for this task; the game ships only the processed files at the paths
below.

| Working output                                  | Prompt record                                                                                                                                                                                                                | Shipped files                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `exec-8c86f08f-a91e-4bdd-a2a0-dbe660c43389.png` | Square pixel-art portrait of an original fire iguana monster, isolated on a pure chroma-key background, no text, logo, existing character, or franchise reference.                                                           | `assets/images/monster-tamer/monsters/iguanignite.png`                                   |
| `exec-4948ab2c-0325-47cc-a5b9-afae1b3abed4.png` | Square pixel-art portrait of an original dusk-colored horned carnivore monster, isolated on a pure chroma-key background, no text, logo, existing character, or franchise reference.                                         | `assets/images/monster-tamer/monsters/carnodusk.png`, compatibility alias `parazoid.png` |
| `exec-afb23e35-845c-460a-99c4-715a94af37c8.png` | Square pixel-art portrait of an original electric storm creature, isolated on a pure chroma-key background, no text, logo, existing character, or franchise reference.                                                       | `assets/images/monster-tamer/monsters/ignivolt.png`                                      |
| `exec-c5fc1a6d-201c-43bb-962d-15d44e518407.png` | Square pixel-art portrait of an original aquatic guardian monster, isolated on a pure chroma-key background, no text, logo, existing character, or franchise reference.                                                      | `assets/images/monster-tamer/monsters/aquavalor.png`, compatibility alias `jivy.png`     |
| `exec-55027fd6-b1e1-4262-bc41-54a7101236c1.png` | Square pixel-art portrait of an original frost saber-cat monster, isolated on a pure chroma-key background, no text, logo, existing character, or franchise reference.                                                       | `assets/images/monster-tamer/monsters/frostsaber.png`                                    |
| `exec-6b7c5914-59a9-4bb8-bb68-8bd8d13521f5.png` | Wide original pixel-art title landscape with floating basalt islands, waterfalls, an observatory, ancient teal waystones, sunrise, no characters, logos, or text.                                                            | `assets/images/monster-tamer/ui/title/background.png`                                    |
| `exec-a0d3f6aa-6cc9-40c0-a851-2236328660e1.png` | Wide original pixel-art forest battle clearing at night, circular stone arena, waterfall, blue luminous mushrooms, no characters, logos, or text.                                                                            | `assets/images/monster-tamer/battle-backgrounds/forest-background.png`                   |
| `exec-cf026c02-3a0a-4ace-96ac-ca051a33e925.png` | Full-body original young monster-field researcher in teal and burnt orange, pixel-art game sprite illustration, pure chroma-key background, no existing character or franchise reference.                                    | `assets/images/monster-tamer/battle/trainer_youth_boy.png`                               |
| `exec-1ab06ccd-2715-499e-8a1e-3d871efd192f.png` | Full-body original young monster-field researcher in violet exploration clothing with map and crystal compass, pixel-art game sprite illustration, pure chroma-key background, no existing character or franchise reference. | `assets/images/monster-tamer/battle/trainer_youth_girl.png`                              |

Chroma-key removal used the bundled `remove_chroma_key.py` helper. Final
illustrations were resized to the exact dimensions consumed by the fixed game
runtime and written as PNG with the required alpha channel.

## Procedural artwork

`tools/monster-tamer/generate-original-assets.mjs` deterministically generates
the remaining original artwork:

- encounter grass, hidden collision and encounter tiles;
- title panel and title lettering;
- party and inventory backgrounds, bag, cursors;
- capture ball, damaged capture ball; and
- the application favicon.

The seamless valley map and its three nearest-neighbor runtime atlases are not
project-original artwork. They are generated by
`tools/monster-tamer/generate-valley-map.mjs` from the CC0 Kenney Tiny Town
1.1, Tiny Farm 1.0, and Tiny Battle 1.0 source atlases documented in
`THIRD_PARTY_NOTICES.md`. The published Tiny Battle derivative contains only
the shoreline and water tiles used by the map.
