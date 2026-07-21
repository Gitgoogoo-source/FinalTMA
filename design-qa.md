**Baseline Comparison Target Through Iteration 3**

- Source visual truth: Figma `FinalTMA - 开盒界面`, Screens / `01 · 默认态（普通蛋）`, node `14:2692`; capture `/tmp/finaltma-figma-source.png`.
- Implementation capture: `/tmp/finaltma-gacha-default-430x932.png`.
- Combined full-view and focused evidence: `/tmp/finaltma-gacha-comparison.png`, `/tmp/finaltma-gacha-focused-comparison.png`.
- Viewport: 430 × 932, light theme, default normal-box state.
- Additional states: selected rare `/tmp/finaltma-gacha-selected-rare-430x932.png`; opening `/tmp/finaltma-gacha-opening-430x932.png`; success `/tmp/finaltma-gacha-success-430x932.png`; insufficient balance `/tmp/finaltma-gacha-shortage-430x932.png`; responsive 390 × 844 `/tmp/finaltma-gacha-narrow-390x844.png`.

**Baseline Findings Through Iteration 3**

- No actionable P0/P1/P2 mismatch remains.
- Fonts and typography: the implementation uses the existing Apple/SF rounded system stack and matches the Figma hierarchy, optical weights, truncation, and compact mobile labels.
- Spacing and layout rhythm: top bar, title row, 240px hero, 124px tier cards, reward row, pity capsule, 76px actions, and shared bottom navigation align with the 430 × 932 Figma frame. The 390 × 844 and 320px checks have no horizontal overflow; the 390px primary actions remain above the shared navigation.
- Colors and visual tokens: warm paper background, orange selected/action states, translucent white surfaces, low-contrast borders, and soft elevation match the Figma palette.
- Image quality and asset fidelity: the final implementation reuses the project's alpha-enabled `normal.webp`, `legendary.webp`, and `rare.webp` assets with the Figma tier mapping. No placeholder, missing image, or opaque background halo remains.
- Copy and content: real API-provided box names, prices, reward data, pity text, balances, and user identity are intentionally preserved where the Figma sample copy differs.

**Focused Region Comparison**

- The focused side-by-side evidence compares the complete 430 × 932 source frame and implementation at equal size. The mechanical egg art, tier-card proportions, selected ring, reward thumbnails, pity capsule, draw actions, and bottom navigation are readable and aligned, so no additional crop was required.

**Comparison History**

- Iteration 1 — P1: the deployed view had missing rare/legendary images and a crowded VIP block above the hero. Fix: corrected tier asset mapping and moved existing VIP/free-entitlement content below the primary Figma viewport while retaining its business behavior.
- Iteration 2 — P2: the first implementation was vertically compressed and left excessive blank space above the bottom navigation. Fix: matched the Figma vertical metrics with responsive `clamp()` sizing and moved the shared navigation to the Figma inset. Post-fix evidence: `/tmp/finaltma-gacha-focused-comparison.png`.
- Iteration 3 — P2: temporary replacement egg images differed from Figma's mechanical eggs. Fix: removed the replacements and reused the current project's transparent originals with the correct visual tier mapping. Post-fix evidence: all five final state captures listed above.
- Iteration 4 — User-approved layout correction: removed the separate free-normal/free-rare summary and moved the existing VIP status, 100 Fgems, and rare-box entries into a vertical absolute-positioned group below the back control at the left of the unchanged hero art. This user-approved region supersedes the earlier Figma placement while retaining the existing business behavior.

**Iteration 4 Deployment Verification**

- Vercel production deployment `dpl_8jKt3p5ZsLgKdCQXQbsjY2CNemjq` is Ready and owns `https://final-tma-pi.vercel.app`.
- The production gacha chunk renders the VIP daily-benefit component as the first child of `gacha-hero` and contains none of `gacha-business-extras`, `gacha-free-summary`, or the removed free-normal/free-rare summary copy.
- The production stylesheet fixes the group at `top: 6px; left: 2px` with `position: absolute` and `flex-direction: column`; claim feedback is also absolutely positioned to the right and does not enter layout flow.
- The pre-deployment Telegram WebView was closed after the alias changed. Telegram Desktop did not expose the chat's `Open PokePets` control to the computer-use accessibility interface, so no post-deployment Telegram screenshot is recorded as accepted. The required acceptance action is to reopen `Open PokePets` in Telegram and inspect the default open-box page; if the vertical group obscures an interactive control at the real viewport width, restore the preceding stable deployment `https://final-pk9esape5-googoos-projects-4fca1021.vercel.app` and correct the layout before acceptance.

**Primary Interactions and Browser Checks Through Iteration 3**

- Verified default and rare selected states, opening progress, single-result success, and insufficient-balance modal using the final component classes, CSS, assets, and real business copy structure.
- Verified 430 × 932, 390 × 844, and 320px widths; no horizontal overflow.
- Browser console errors checked: none. Existing unauthenticated Telegram SDK capability warnings were unrelated to the QA surface.

**Follow-up Polish**

- The Figma sample brand label and example values intentionally differ from the runtime Telegram identity and API data; no visual fix is required.

**Implementation Checklist**

- [x] Shared top asset bar and bottom navigation retained globally.
- [x] Default, selected, opening, success, insufficient-balance, and failure presentation covered.
- [x] Real API/data/interaction boundaries preserved.
- [x] Phone-width desktop containment and narrow-screen responsiveness verified.
- [x] Formatting, TypeScript production build, asset integrity, and browser console checks passed.

final result: iteration 4 implementation and production deployment passed; post-deployment Telegram visual acceptance requires the recorded manual reopen action
