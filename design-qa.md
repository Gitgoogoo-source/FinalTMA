# Telegram 顶部安全区设计验收

## 验收对象

- 版本：`e0bc9eb`
- 环境：Vercel Production，Telegram iOS 真机，iPhone 15 Pro Max
- 页面：交易、游戏、开盒、藏品、任务
- 状态：已登录、默认主页面状态、无弹窗
- 截图规格：来源与实现均为 344 × 764 px，按 1:1 像素密度比较

## 视觉依据

来源截图：

- `/tmp/finaltma-top-safe-area-audit/01-market-before.png`
- `/tmp/finaltma-top-safe-area-audit/02-game-before.png`
- `/tmp/finaltma-top-safe-area-audit/03-gacha-before.png`
- `/tmp/finaltma-top-safe-area-audit/04-album-before.png`
- `/tmp/finaltma-top-safe-area-audit/05-tasks-before.png`

最终实现截图：

- `/tmp/finaltma-top-safe-area-audit/09-market-final.png`
- `/tmp/finaltma-top-safe-area-audit/10-game-final.png`
- `/tmp/finaltma-top-safe-area-audit/08-gacha-final.png`
- `/tmp/finaltma-top-safe-area-audit/11-album-final.png`
- `/tmp/finaltma-top-safe-area-audit/12-tasks-final.png`

## 同屏比较证据

完整页面左右对照，左侧为修复前、右侧为最终实现：

- `/tmp/finaltma-top-safe-area-audit/qa-full-market.png`
- `/tmp/finaltma-top-safe-area-audit/qa-full-game.png`
- `/tmp/finaltma-top-safe-area-audit/qa-full-gacha.png`
- `/tmp/finaltma-top-safe-area-audit/qa-full-album.png`
- `/tmp/finaltma-top-safe-area-audit/qa-full-tasks.png`

五页顶部区域集中对照：

- `/tmp/finaltma-top-safe-area-audit/qa-focused-top-five-pages.png`

## 检查结果

- Telegram 原生关闭、收起和更多控件位于最上方独立区域。
- 五页共用的头像、TON、K-coin、Fgems 和刷新入口整体位于原生控件行下方，没有遮挡或重叠。
- 开盒页与任务页的页内返回按钮位于资产栏下方，完整可见，触控区域没有被头像或 Telegram 控件覆盖。
- 底部导航位置不变；页面纵向内容继续通过原有滚动区域承载，没有缩小卡片或隐藏功能。
- 字体、字号、颜色、圆角、阴影、图片、文案、组件宽高和横向间距均未改变。
- 唯一视觉差异是五页统一内容起点在 Telegram iOS 真机上增加原生控件补充间距。
- 未发现 P0、P1 或 P2 视觉问题。

## 比较历史

1. 初始线上版本：设备安全区之后的头像资产栏与 Telegram 原生控件行重叠。
2. `a64e1b1`：回退依赖 `isFullscreen`，真机在该值为假时仍显示覆盖控件，验收失败。
3. `70f6c36`：将 44px 作为绝对顶部最小值；真机已有约 47px 设备安全区，`max(47, 44)` 没有产生位移，验收失败。
4. `e0bc9eb`：将 44px 改为设备安全区之后的原生控件补充量；五页同屏对照与真机逐页验收通过。

final result: passed
