# Design QA — 交易购买页紧凑布局

## Comparison target

- Source visual truth:
  - `/Users/mac/Desktop/旧项目本地保留/tmaGameOld/screens-2.jsx`
  - `/private/tmp/finaltma-old-market-buy-430x720.png`
  - `/Users/mac/Desktop/图片/buy.png`
- Implementation screenshot:
  - `/private/tmp/finaltma-market-buy-density-final-430x720.png`
- Combined comparison:
  - `/private/tmp/finaltma-market-density-comparison-final.png`
- Viewport: browser `1280 × 720` CSS px, device scale factor `1`; implementation app shell cropped at its native `430 × 720` CSS px.
- Density normalization: old implementation rendered and captured at `430 × 900`, then cropped to `430 × 720`; FinalTMA implementation rendered in a native `430px` app shell and cropped to `430 × 720`. Both comparison inputs are `430 × 720` pixels at `1x`.
- State: 交易 → 购买，VIP 区可见，4 个筛选关闭，6 个真实目录图片示例组成两行三列卡片。

## Full-view comparison evidence

The final comparison preserves FinalTMA's existing product content while matching the old project's compact layout rhythm:

- top asset controls: `38px` high;
- tab container/button: `38px` / `34px`;
- filter buttons: `31px` high with `7px` gaps;
- purchase grid: three equal columns with `7px` gaps;
- purchase card/action: `132 × 211px` / `47 × 24px`;
- bottom navigation: `406 × 58px`.

The old rendered reference measured `31px` filter controls, `7px` grid gaps, cards at approximately `123 × 196px`, and purchase actions at `38 × 24px`.

## Focused comparison evidence

A separate focused crop was not needed because all required controls and card text are legible at the normalized `430px` full-view width. Computed browser measurements were used for the small control surfaces.

## Required fidelity surfaces

- Fonts and typography: retained FinalTMA's SF/PingFang system stack and hierarchy; compact labels remain legible without wrapping or clipping.
- Spacing and layout rhythm: control heights and gaps follow the old project; no horizontal overflow was observed.
- Colors and visual tokens: retained FinalTMA's orange, cream, glass surfaces, active states, borders, and shadows.
- Image quality and asset fidelity: used existing catalog images at a square crop; no placeholders, generated substitutes, or custom illustration code were introduced.
- Copy and content: retained the current VIP, price, rarity, stage, availability, and purchase text. The old hero/recent-sale content was not copied because that would change product behavior.
- Icons: retained the project's existing Lucide icon family and current semantic mappings.
- States and interactions: the sort filter opened to four options, reported `aria-expanded="true"`, closed again, and produced no browser console warnings or errors.
- Accessibility: semantic buttons, labels, active state, focus style, alt text, and reduced-motion behavior remain provided by the existing application.

## Findings

No actionable P0, P1, or P2 visual mismatches remain.

Accepted product differences:

- FinalTMA keeps its VIP card instead of the old project's hero and recent-sale feed.
- FinalTMA cards are approximately `15px` taller because they retain both official unit price and real available quantity.
- Telegram-authenticated API behavior was not replaced or bypassed for this visual-only QA.

## Comparison history

1. First implementation pass:
   - Finding: purchase cards were `234px` high and the `120 × 28px` full-width action still occupied too much area.
   - Severity: P2.
   - Fix: moved official price and availability into a compact facts block and placed the purchase action beside it.
2. Final implementation pass:
   - Evidence: cards reduced to `211px`; actions reduced to `47 × 24px`; all labels remained readable; the three-column grid and `7px` spacing matched the old layout rhythm.
   - Result: no remaining P0/P1/P2 findings.

## Implementation checklist

- [x] Preserve all current data and API behavior.
- [x] Scope top and bottom shell density to the purchase tab.
- [x] Keep sell and manage layouts unchanged.
- [x] Verify formatting, lint, TypeScript, and the web production build.
- [x] Verify the rendered purchase layout and filter interaction.

final result: passed
