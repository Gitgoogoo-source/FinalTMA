# Design QA — 交易购买页紧凑布局

## Comparison target

- Source visual truth:
  - `/Users/mac/Desktop/旧项目本地保留/tmaGameOld/screens-2.jsx`
  - `/private/tmp/finaltma-old-market-buy-430x720.png`
  - `/Users/mac/Desktop/图片/buy.png`
- Implementation screenshot:
  - `/private/tmp/finaltma-market-buy-density-final-430x720.png`
  - `/private/tmp/finaltma-market-navigation-buy-correction.png`
  - `/private/tmp/finaltma-market-navigation-manage-correction.png`
- Combined comparison:
  - `/private/tmp/finaltma-market-density-comparison-final.png`
  - `/private/tmp/finaltma-market-navigation-correction-comparison.png`
- Viewport: browser `1280 × 720` CSS px, device scale factor `1`; implementation app shell cropped at its native `430 × 720` CSS px.
- Density normalization: old implementation rendered and captured at `430 × 900`, then cropped to `430 × 720`; FinalTMA implementation rendered in a native `430px` app shell and cropped to `430 × 720`. Both comparison inputs are `430 × 720` pixels at `1x`.
- State: 交易 → 购买的紧凑内容，以及同一个市场页签组件依次切换购买、出售、管理三个分页面。
- Live shared-shell verification: Telegram Desktop Mini App at `https://final-tma-pi.vercel.app`, Vercel deployment `dpl_8WEuPZpfPUYxwubkmnmEhDy7tXvQ`, checked on 2026-07-24 across 交易、游戏、开盒、藏品、任务.

## Full-view comparison evidence

The final comparison preserves FinalTMA's existing product content while matching the old project's compact layout rhythm:

- top asset bar in this historical screenshot pass: unchanged from the shared application layout that existed when the screenshots were captured;
- historical shared top bar/wallet control captured in this pass: `72px` / `42px`;
- shared market tab container/button: `402 × 38px` / `34px` on buy, sell, and manage;
- filter buttons: `31px` high with `7px` gaps;
- purchase grid: three equal columns with `7px` gaps;
- historical bottom navigation captured in this pass: `406 × 58px`.

The old rendered reference measured `31px` filter controls, `7px` grid gaps, cards at approximately `123 × 196px`, and purchase actions at `38 × 24px`. The current purchase grid keeps the same three-column density while inheriting the shared `14px` market-page padding.

## 2026-07-24 shared-shell adjudication

The user’s 2026-07-24 adjudication replaces the historical `72px` top-bar height, `42px` wallet control, and `406 × 58px` bottom navigation as the current shared-shell geometry. The single current baseline is:

- top asset content height: `54px`;
- top asset inner maximum width: `382px`;
- avatar: `48 × 48px`;
- wallet control: `48 × 38px`;
- K-coin and Fgems controls: `82 × 38px` each;
- bottom navigation: `378 × 60px`;
- bottom-navigation offset: `10px` above the device bottom safe area;
- each bottom-navigation button: `46px` high.

All five main pages use this same shell geometry. The 2026-07-24 Telegram live pass confirmed that the same top asset bar and bottom navigation render without horizontal overflow on 交易、游戏、开盒、藏品、任务, including the task page’s formerly higher-specificity shell rules.

## Focused comparison evidence

The navigation correction used `/private/tmp/finaltma-market-navigation-correction-comparison.png` as focused historical evidence. It confirms that, in that captured implementation, the top asset bar kept the then-current shared size and the market switcher used the same position and dimensions in all three active states. It does not verify the 2026-07-24 shared-shell dimensions.

## Required fidelity surfaces

- Fonts and typography: retained FinalTMA's SF/PingFang system stack and hierarchy; compact labels remain legible without wrapping or clipping.
- Spacing and layout rhythm: the shared market switcher uses the same compact dimensions on buy, sell, and manage; purchase control heights and gaps follow the old project; no horizontal overflow was observed.
- Colors and visual tokens: retained FinalTMA's orange, cream, glass surfaces, active states, borders, and shadows.
- Image quality and asset fidelity: used existing catalog images at a square crop; no placeholders, generated substitutes, or custom illustration code were introduced.
- Copy and content: retained the current VIP, price, rarity, stage, availability, and purchase text. The old hero/recent-sale content was not copied because that would change product behavior.
- Icons: retained the project's existing Lucide icon family and current semantic mappings.
- States and interactions: the sort filter opened to four options and closed again in the purchase-layout pass. The correction pass switched the same market navigation through buy, sell, and manage; no browser console errors occurred.
- Accessibility: semantic buttons, labels, active state, focus style, alt text, and reduced-motion behavior remain provided by the existing application.

## Findings

No actionable P0, P1, or P2 market purchase-density mismatch remained in the historical screenshot pass. The 2026-07-24 Telegram live pass found no shared-shell clipping, horizontal overflow, or page-specific size override across the five main pages.

Accepted product differences:

- FinalTMA keeps its VIP card instead of the old project's hero and recent-sale feed.
- FinalTMA cards are approximately `15px` taller because they retain both official unit price and real available quantity.
- Telegram-authenticated API behavior was not replaced or bypassed for this visual-only QA.

## Comparison history

1. First implementation pass:
   - Finding: purchase cards were `234px` high and the `120 × 28px` full-width action still occupied too much area.
   - Severity: P2.
   - Fix: moved official price and availability into a compact facts block and placed the purchase action beside it.
2. Navigation scope correction:
   - Finding: the first implementation changed the top asset bar and scoped the shared buy/sell/manage switcher to the purchase state.
   - Severity: P1.
   - Fix: removed every market-specific top asset bar override and moved the compact switcher styling to the shared `.market-page .market-tabs` component used by all three subpages.
3. Final implementation pass:
   - Evidence: the three-column grid and `7px` spacing retain the old layout rhythm; all labels remain readable.
   - Historical evidence: the captured top asset bar was `72px` high with a `42px` wallet control, while the exact same `402 × 38px` market switcher and `34px` tab buttons rendered on buy, sell, and manage.
   - Historical result: no remaining P0/P1/P2 market purchase-density findings in that captured shell.

## Implementation checklist

- [x] Preserve all current data and API behavior.
- [x] Keep the top asset bar on its shared application layout.
- [x] Use one shared compact market switcher for buy, sell, and manage.
- [x] Keep purchase-specific card and filter density scoped to the buy page.
- [x] Verify formatting, lint, TypeScript, and the web production build.
- [x] Verify the rendered purchase layout and filter interaction.
- [x] Verify the shared top asset bar and bottom navigation on all five main pages in Telegram.

final result: historical market purchase-density pass retained; the 2026-07-24 shared-shell geometry passed Telegram live verification on all five main pages
