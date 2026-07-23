# 出售页全竖屏自适应设计 QA

- Source visual truth:
  - `/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-b5f0dbd8-3b44-4d37-b37d-81ff355bbb0c.png`
  - `/private/tmp/finaltma-market-sell-before.png`
- Deployed implementation: `https://final-tma-pi.vercel.app/market?sell=PET-N-006-1`
- Deployment: `dpl_E1uxGHuu8XKvoABg7xm8H4vX1b1R`
- State: 出售页；真实 Telegram 用户、真实可售藏品与真实价格摘要；未提交出售
- Real Telegram viewport capture: `421 × 715 px`，其中 Mini App 内容区约为 `401 × 646 CSS px`
- Tested responsive CSS viewports:
  - `320 × 568 px`，安全区 `20 / 0 px`
  - `360 × 640 px`，安全区 `24 / 24 px`
  - `375 × 667 px`，安全区 `20 / 0 px`
  - `390 × 844 px`，安全区 `47 / 34 px`
  - `430 × 932 px`，安全区 `59 / 34 px`
- Implementation screenshot: `/private/tmp/finaltma-market-sell-final-live.png`
- Full-view comparison: `/private/tmp/finaltma-market-sell-final-comparison.png`
- Focused lower-controls comparison: `/private/tmp/finaltma-market-sell-final-focus-comparison.png`
- Multi-viewport evidence:
  - `/private/tmp/finaltma-market-sell-qa-release-320x568-se.png`
  - `/private/tmp/finaltma-market-sell-qa-release-360x640-android.png`
  - `/private/tmp/finaltma-market-sell-qa-release-375x667-ios.png`
  - `/private/tmp/finaltma-market-sell-qa-release-390x844-ios.png`
  - `/private/tmp/finaltma-market-sell-qa-release-430x932-ios.png`
- Density normalization: 前后真实 Telegram 截图均为 `421 × 715 px`，未缩放；多尺寸验证均按对应 CSS 视口以 `deviceScaleFactor 1` 捕获

## Findings

没有剩余可执行的 P0、P1 或 P2 问题。

- [P3] `320 × 568 px` 的辅助说明文字采用最小字号。
  - Location: 藏品事实、价格说明与结算说明。
  - Evidence: 最短视口中主按钮、数量值和金额仍清晰，辅助说明保持可见但密度较高。
  - Impact: 不影响出售对象选择、数量调整、金额确认与提交入口。
  - Follow-up: 不继续放大；否则会破坏已确认的“无需页面滚动”目标。

## Comparison history

### Iteration 1

- [P1] 原出售页首屏只显示标题、藏品大图和缩略图；官方价格、出售数量、结算与确认出售均在首屏之外。
- Fix: 删除重复的“出售 NFT / 可出售藏品数量”标题，并压缩大图、缩略图、价格摘要与表单。
- Post-fix evidence: `/private/tmp/finaltma-market-sell-after.png` 中价格、数量、结算、确认出售和主导航首次同时进入真实 Telegram 首屏。

### Iteration 2

- [P2] 第一轮尺寸依据原始 `dvh` 缩放，没有把 Telegram 上下安全区从内容高度中共同扣除；短屏与大安全区组合仍可能产生纵向挤压。
- Fix: 以 `min(Telegram stable viewport, 100dvh) - safe top - safe bottom` 计算工作区，再按 `31% / 21.5% / 12% / 29%` 分配大图、缩略图、价格摘要与表单。
- Post-fix evidence: 五种 iOS/Android 竖屏测试的 `document.scrollHeight` 均等于视口高度，确认出售按钮底边均位于主导航顶边之上。

### Iteration 3

- [P1] 缩略图使用自动隐式列宽时，在真实 42 种藏品数据中列宽坍缩并出现卡片挤叠。
- Fix: 使用工作区容器高度单位计算明确的方形缩略图列宽，并提供 `dvh` 回退值；双行结构继续横向滚动。
- Post-fix evidence: `/private/tmp/finaltma-market-sell-final-live.png` 中真实数据缩略图互不重叠；五种尺寸中每张缩略图均为方形，测试样本均形成 5 个独立列位。

## Required fidelity surfaces

- Fonts and typography: 延续项目现有系统圆角字体、粗细与橙色强调；主名称、数量、金额和确认文案保持最高层级，短屏只压缩辅助文字。
- Spacing and layout rhythm: 保留“页签 → 选中藏品 → 双行缩略图 → 价格摘要 → 数量与结算 → 确认出售 → 主导航”的唯一顺序；长屏按比例放大，短屏按安全区后的可用高度收缩。
- Colors and visual tokens: 沿用暖白背景、橙色主操作、浅色卡片和现有稀有度颜色，没有引入第二套视觉变量。
- Image quality and asset fidelity: 大图和全部缩略图继续使用项目正式藏品资源，没有新增占位素材、CSS 绘图或外部图标替代。
- Copy and content: 已删除用户指定的重复标题与数量文案；官方单价、预计成交、手续费、出售数量、到账、月卡返还和确认出售均保留。
- Icons and states: 继续使用现有图标体系、选中描边、数量禁用态与橙色主按钮；真实页面的可售数量状态由后端数据决定。
- Accessibility: 所有交互仍为语义按钮；真实 Telegram 无障碍树可读取页签、藏品选择、数量增减、确认出售和五项主导航。

## Runtime and interaction checks

- 真实 Telegram 首屏同时包含购买/出售/管理页签、选中藏品、双行缩略图、三项价格摘要、数量控件、结算信息、确认出售和五项底部导航。
- “出售 NFT”及“42 种藏品可出售”不再出现在真实 Telegram 无障碍树和画面中。
- 五种测试视口均无页面纵向滚动，确认出售按钮未与底部导航重叠。
- 五种测试视口的缩略图均保持方形且存在独立列位，横向列表可继续滚动。
- 未点击确认出售、购买、充值或月卡，也未消耗 K-coin、Fgems、藏品、道具或 Telegram Stars。

## Automated verification

- `pnpm exec prettier --check apps/web/src/domains/market/ui/MarketView.tsx apps/web/src/domains/market/ui/market-density.css docs/product/功能说明文档.md design-qa.md`: passed
- `pnpm --filter @pokepets/web build`: passed
- Vercel production build: passed
- Development release assets: all 425 path-valid, format-valid, hash-locked, and present
- Multi-viewport browser console errors: `0`
- `git diff --check -- apps/web/src/domains/market/ui/MarketView.tsx apps/web/src/domains/market/ui/market-density.css docs/product/功能说明文档.md design-qa.md`: passed

final result: passed
