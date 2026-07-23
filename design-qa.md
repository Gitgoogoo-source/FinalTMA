# 开盒页多屏自适应设计 QA

- Source visual truth: `/Users/mac/Desktop/图片/开盒.png`
- Reference implementation: `/Users/mac/Desktop/旧项目本地保留/tmaGameOld/screens-1.jsx`
- Deployed implementation: `https://final-tma-pi.vercel.app/`
- Deployment: `dpl_4mQmfFavrPULpYNtSponNxRRde8g`
- State: 普通盲盒；使用当前正式 CSS、现有组件类结构、正式盲盒与藏品资源渲染响应式布局
- Tested CSS viewports: `401 × 646 px`、`401 × 852 px`、`430 × 932 px`
- Source pixels: `941 × 1670 px`
- Implementation screenshot: `/private/tmp/finaltma-gacha-responsive-frame-qa.png`（`1330 × 980 px`，三种视口并排）
- Full-view comparison: `/private/tmp/finaltma-gacha-adaptive-comparison.jpg`
- Focused action comparison: `/private/tmp/finaltma-gacha-adaptive-actions.jpg`
- Density normalization: 来源图按高度缩放至 `980 px` 后与实现截图并排；实现中的三个应用视口均以 CSS 像素 1:1 渲染

## Findings

没有剩余可执行的 P0、P1 或 P2 问题。

- [P3] 五位数 Fgems 在真实 Telegram 顶部资产胶囊中可能继续使用省略显示。
  - Location: 顶部资产栏。
  - Evidence: 本任务修改前的真实 Telegram 截图显示 `10,4…`，无障碍名称包含完整真实值。
  - Impact: 不影响首屏按钮、纵向自适应或资产事实读取。
  - Follow-up: 后续统一处理顶部资产栏时增加五位数余额文本空间。

## Comparison history

### Iteration 1

- [P1] 原 Telegram 首屏只显示到档次选择与部分奖池内容，两个开盒按钮必须滚动后才能看到。
- Fix: 对短移动视口压缩页面标题、主视觉、档次卡、奖池、保底和操作按钮，不删除业务信息或交互。
- Post-fix evidence: `/private/tmp/finaltma-gacha-telegram-compact.png` 中全部功能按钮进入 `401 × 646 px` 首屏。

### Iteration 2

- [P1] 第一轮仅在 `max-height: 820px` 下启用固定紧凑尺寸；更高手机仍沿用紧凑上半屏，导致开盒按钮下方出现大块空白。
- Fix: 将移动端布局改为全高度连续响应式。页面标题、盲盒主视觉、档次卡、奖池缩略图、保底胶囊和操作按钮均通过 `clamp()` 与 `dvh` 随真实视口高度增长；内容区使用真实稳定视口高度分配纵向空间。
- [P2] 初次多屏测量发现开盒按钮底边进入固定底部导航约 `6 px`。
- Fix: 将内容区终点上移，保证按钮与导航之间保留安全间距。
- Post-fix evidence:
  - `401 × 646 px`: 文档高度 `646 px`，操作区底边 `546.4 px`，导航顶边 `560 px`，间距 `13.6 px`。
  - `401 × 852 px`: 文档高度 `852 px`，操作区底边 `746 px`，导航顶边 `766 px`，间距 `20 px`。
  - `430 × 932 px`: 文档高度 `932 px`，操作区底边 `826 px`，导航顶边 `846 px`，间距 `20 px`。
  - 三种视口的 `scrollHeight` 均等于视口高度，页面无需滚动。
  - `/private/tmp/finaltma-gacha-adaptive-actions.jpg` 显示两个开盒按钮均完整位于底部导航上方，没有裁切、遮挡或大块下半屏留白。

## Required fidelity surfaces

- Fonts and typography: 延续项目现有系统圆角字体、粗细与橙色强调；价格、概率、保底和按钮文案随屏幕高度缩放但不隐藏。
- Spacing and layout rhythm: 保留“主视觉 → 档次 → 可能获得 → 保底 → 开盒操作 → 主导航”顺序；矮屏压缩、长屏放大并均匀使用纵向空间。
- Colors and visual tokens: 沿用暖白背景、橙色主操作、浅色玻璃卡片与现有稀有度颜色，没有引入第二套视觉变量。
- Image quality and asset fidelity: 主盲盒、档次缩略图和藏品缩略图继续使用项目正式资源，没有占位图、CSS 绘图或新外部素材。
- Copy and content: 保留真实页面的盲盒名称、K-coin 价格、概率、保底与全部功能入口；参考图中的示例 Points/Star 数据未进入项目。

## Interaction and runtime checks

- 三种视口都可同时看到三档盲盒、查看全部、五个奖池入口、保底、两个开盒按钮和五项底部导航。
- 所有视口均无页面纵向滚动，操作区与底部导航之间存在明确安全间距。
- 未点击开盒、充值、购买月卡或领取权益，没有消耗 K-coin、Fgems、资格、道具或 Telegram Stars。
- 最新部署已进入 `READY` 并绑定 `https://final-tma-pi.vercel.app/`。
- 当前 Telegram Mini App 会话已过期，外部应用唤起被浏览器安全策略拦截，因此本轮没有取得最新部署的真实 Telegram WebView 截图；多屏视觉结论来自当前正式 CSS 与组件结构的 1:1 隔离渲染。

## Automated verification

- `pnpm exec prettier --check apps/web/src/shared/styles/global.css`: passed
- `pnpm --filter @pokepets/web build`: passed
- Vercel production build: passed
- Development release assets: all 425 path-valid, format-valid, hash-locked, and present
- `git diff --check`: passed

final result: passed
