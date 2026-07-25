# 藏品进化预览设计 QA

- Source visual truth: `/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-3936ec3e-77f9-4306-920d-785975c3b331.png`
- Implementation screenshot: blocked; local browser reached the required Telegram authentication gate instead of the inventory route
- Blocker screenshot: `/tmp/finaltma-evolution-local-auth-gate.png`
- Intended viewport: `430 × 900 CSS px`
- Source pixels: `380 × 650 px`
- Blocker screenshot pixels: `430 × 900 px`
- Density normalization: browser capture used `deviceScaleFactor 1`; no implementation comparison was possible
- Intended state: current material available quantity `1`, two empty material slots, disabled “开始进化”

## Findings

- [P0] The real evolution preview could not be rendered in the local browser.
  - Location: local `/inventory` route.
  - Evidence: the application correctly stopped at “请从 Telegram Mini App 打开应用” because the browser had no real Telegram `initData`.
  - Impact: the source image and the implemented preview cannot be placed into a valid same-state visual comparison, so layout, responsive fit and disabled-button appearance are not visually accepted.
  - Fix: deploy the same commit to the authorized real development environment, open it from the real Telegram Mini App, and capture the one-material and three-or-more-material states without submitting an evolution.

## Required fidelity surfaces

- Fonts and typography: implemented with the existing FinalTMA `SF Pro Rounded / Inter / system-ui` stack; browser-rendered preview evidence is blocked.
- Spacing and layout rhythm: code defines the requested top material, central target, left/right material layout with a fixed footer; browser-rendered preview evidence is blocked.
- Colors and visual tokens: implementation uses the existing warm white, orange and blue-gray FinalTMA tokens rather than the reference image palette; browser-rendered preview evidence is blocked.
- Image quality and asset fidelity: implementation uses the official Catalog v1 thumbnail assets for all filled material and target slots, and the existing icon library for empty slots and connectors; browser-rendered preview evidence is blocked.
- Copy and content: static inspection confirms “藏品进化”, dynamic rarity transition, base success rate, total Fgems, batch quantity, shortage reason and “开始进化”; browser-rendered preview evidence is blocked.

## Runtime and interaction checks

- Local browser used the requested `430 × 900` mobile viewport.
- The authentication gate rendered without layout overflow.
- Browser logs contained only expected Telegram SDK capability warnings caused by the non-Telegram browser; the preview component did not mount.
- No evolution request, asset mutation or other business operation was executed.
- ESLint, Web TypeScript, Web production build, architecture check, contracts check and changed-file formatting passed.
- Full-project format check remains blocked by the pre-existing unrelated `monster玩法说明.md` formatting drift.
- Product-data check remains blocked by the pre-existing unrelated task-definition drift in `20260719104602_product_data_v1.sql`; the new 140-route frontend evolution manifest independently regenerates byte-for-byte and has zero Catalog target or chain-stage mismatches.

## Comparison history

No visual comparison iteration was valid because the implementation state could not be rendered outside a real Telegram session.

final result: blocked
