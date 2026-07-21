# Task Page Design QA

- Source visual truth: `/Users/mac/Desktop/图片/任务.png`
- Deployed implementation: `https://final-tma-pi.vercel.app/tasks`
- Final deployment: `dpl_978grsvt4pxsQ641teWxek8pAov9`
- Telegram viewport: `420 × 731`; application content width: `400 px`
- Tested state: authenticated Telegram Mini App with live account, referral, check-in, and task responses
- Final top capture: `/private/tmp/finaltma-tasks-telegram-iteration3-top.png`
- Final check-in capture: `/private/tmp/finaltma-tasks-telegram-iteration3-checkin.png`
- Final task-list capture: `/private/tmp/finaltma-tasks-telegram-iteration3-mid.png`

## Comparison evidence

- Full-view side-by-side: `/private/tmp/finaltma-task-design-compare-final.png`
- Check-in side-by-side: `/private/tmp/finaltma-task-checkin-compare-final.png`
- Iteration 2 side-by-side: `/private/tmp/finaltma-task-design-compare-iteration2.png`
- Iteration 2 invitation focus: `/private/tmp/finaltma-task-hero-compare-iteration2.png`

The reference and Telegram captures were normalized to the same `400 px` content width before review. The Telegram chrome was excluded from the implementation crop. The live application viewport is shorter than the reference device, so the fixed navigation appears earlier vertically; the page remains scrollable and no content is unreachable.

## Findings and fixes

### Iteration 1

- [P1] The invitation block consumed too much of the first viewport and pushed the statistics and check-in content behind the fixed navigation.
  - Fix: reduced invitation artwork and card height, compacted spacing and actions, and lowered the fixed navigation within the safe area.
- [P2] Four-digit asset balances were truncated in the task-page top bar.
  - Fix: added task-route-specific pill widths and a narrower identity area. The final Telegram capture shows `9,918` and `9,999` in full.
- [P2] Referral-code and raw-link rows increased visual density and did not exist in the reference layout.
  - Fix: removed those visible rows while preserving both real copy and Telegram-share actions through the existing API response.
- [P2] Check-in units and task metadata were too small.
  - Fix: increased check-in unit, task description, progress, and reward typography.

### Iteration 2

- [P1] The “今日重点” card duplicated the check-in/task entry and still displaced the reference page hierarchy.
  - Fix: removed the duplicate visual entry from the task page; the real check-in and task actions remain in their canonical sections.
- [P1] The invitation benefit displayed a fixed `5 / 10` value while the live account had `0` valid recharge friends.
  - Fix: bound the displayed benefit progress to `valid_recharge_friends` from `referral.get`. The final capture shows the live value `0 / 10`.
- [P2] The milestone explanation repeated progress already represented by the benefit and statistics rows.
  - Fix: removed the redundant visual summary, retained live friend counts and cumulative reward values, and exposed the real milestone thresholds in the benefit label.
- [P2] The invitation and statistics sections remained taller than the reference rhythm.
  - Fix: compacted card padding, benefit height, action height, artwork height, section gaps, and statistics height.

### Final review

No actionable P0, P1, or P2 visual defects remain in the captured Telegram states. The final layout matches the reference hierarchy: centered task heading, orange invitation hero with real artwork, benefit panels, primary invitation action, three live statistics, seven-day check-in, horizontal category filters, task cards, and fixed bottom navigation.

Content differences from the reference are intentional and required: the implementation displays the current product's real Fgems rewards, live referral counts, current check-in day, real task titles, real progress, and real claimability states rather than the reference image's sample values.

## Fidelity surfaces

- Typography: dark navy hierarchy and orange emphasis match the reference; live content remains legible at the Telegram viewport.
- Spacing: invitation, statistics, check-in, filters, and task rows follow the reference's compact card rhythm without unreachable content.
- Color: warm white surfaces, pale orange borders, navy text, orange actions, and green reward values match the source palette.
- Assets: `/assets/tasks/invite-gifts.png` is a real `1024 × 768` raster asset, sized with `object-fit: contain`; existing box assets and Lucide icons are used for the remaining reward and navigation imagery.
- Data fidelity: balances, referral progress, referral totals, check-in state, task progress, reward values, and claimability are rendered from existing live responses. No mock task data was introduced.

## Interaction and runtime checks

- Verified the real Telegram Mini App loading state transitions into the populated task page.
- Verified navigation from the live bottom navigation to `/tasks`.
- Verified vertical scrolling through invitation, check-in, filters, and task cards.
- Verified the category strip and all task/action controls remain present in the accessibility tree.
- Sign-in, claim, invite, copy, purchase, and other state-changing business actions were deliberately not triggered during visual QA.
- Telegram Computer Use does not expose the embedded WebView console. No visual runtime error, loading failure, or broken asset appeared in the final authenticated captures; the production build and Vercel build completed successfully.

## Automated verification

- `pnpm --filter @pokepets/web typecheck`: passed
- `pnpm --filter @pokepets/web build`: passed
- `git diff --check`: passed
- Vercel release checks: all 425 development release assets path-valid, format-valid, hash-locked, and present

final result: passed
