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

---

# VIP 月卡主视觉设计验收

## 验收对象

- 版本：`a9b4d5d957738eeac7bda188f8da22bfd3e48fdd`
- 环境：Vercel Production `dpl_3xu1hqzTNLtjH1SBLNpi7Jr3fsLX`，Telegram iOS 真机，iPhone 镜像
- 页面状态：交易 → 购买、浅色主题、已登录、VIP 未开通、市场空状态
- 组件目标：购买页唯一 VIP 月卡主视觉；保留真实价格、权益、状态和购买入口

## 视觉依据

- 用户布局与风格参考：`/Users/mac/Desktop/图片/buy.png`，`941 × 1672px`
- 最终生成主视觉：`/Users/mac/Desktop/FinalTMA/apps/web/public/assets/vip/vip-membership-hero.webp`，`1200 × 500px`
- 真实环境实现截图：`/private/tmp/finaltma-vip-hero-iphone-live.png`，`344 × 764px`
- 线上主视觉资源：`https://final-tma-pi.vercel.app/assets/vip/vip-membership-hero.webp`，HTTP `200`，`image/webp`，`32596` bytes

## 视口与归一化

- iPhone 镜像实现截图为 `344 × 764px`；卡片可见区域约 `312 × 145px`，对应应用 CSS 中 `184px` 高的 VIP 主视觉在镜像窗口内缩放后的结果。
- 全页对照将 `buy.png` 等比缩放到 `764px` 高，与 `344 × 764px` 的实现截图同高排列；结果为 `790 × 764px`。
- 聚焦对照将 `1200 × 500px` 主视觉缩放到 `400 × 167px`，将实现卡片裁切后归一化到 `400 × 186px`，只判断主视觉裁切、图文分区、色彩和清晰度，不把两种产品结构的纵横比差异误判为缺陷。

## 对照证据

- 全页同屏对照：`/private/tmp/finaltma-vip-full-comparison.png`
- VIP 聚焦同屏对照：`/private/tmp/finaltma-vip-focused-comparison.png`
- 原参考的大型角色收藏卡只作为层次、留白、橙色强调和高质感商品主视觉依据；本项目已冻结的 VIP 横幅业务结构不复制参考图中的藏品角色、价格统计、成交动态或购买列表。

## 必查视觉面

- 字体与层级：沿用项目 SF/PingFang 系统栈；英文会员眉题、VIP 主标题、状态说明、权益和价格形成清晰五级层次，真机截图无换行、挤压或异常截断。
- 间距与布局：VIP 卡片高度提升至 `184px`，`24px` 圆角，正文、三项权益与底部价格/按钮形成稳定三段布局；筛选栏仅自然下移，其他页面区域未改动。
- 颜色与令牌：奶油白、琥珀橙和金色与项目现有购买页橙色激活态一致；深棕正文和半透明白色权益块在真实浅色主题下保持可读。
- 图片质量：使用独立 `WebP` 位图资产而非 CSS 绘图或占位图；皇冠完整落在右侧，左侧负空间可承载动态状态，真机未见拉伸、锯齿、压缩色块或异常裁切。
- 文案与业务内容：保留实时 `199 Stars · 30 天`、每日 `100 Fgems`、每日免费稀有盲盒、交易手续费返还和购买按钮；图片本身不固化价格或状态。
- 图标与交互：继续使用项目现有 Lucide 图标；真机点击横幅摘要立即打开 VIP 详情弹窗，关闭后回到购买页。未点击真实 `199 Stars` 购买按钮，避免产生实际付款动作。
- 可访问性：装饰图片使用空 `alt` 并设为 `aria-hidden`；摘要与购买入口继续使用语义按钮，原有禁用状态和焦点行为未被替换。

## Findings

没有发现可执行的 P0、P1 或 P2 视觉问题。

动态的已生效、付款确认中、已过期和续费上限状态未通过修改真实账号或伪造接口进行截图；这些状态继续使用同一受约束的文本槽位、溢出保护和原有按钮逻辑。该真实状态截图缺口不影响当前未开通状态的设计验收。

## 比较历史

1. 初始实现把 VIP 横幅压缩为紧凑信息卡，主视觉高度不足，与“购买页唯一大尺寸主视觉”的冻结文档及用户裁决冲突。
2. 最终实现新增右侧立体皇冠资产、左侧实时状态留白、三项玻璃权益块和突出购买入口，同时将卡片固定为 `184px` 高。
3. 真实部署 `a9b4d5d` 在 Telegram iOS 中完成全页与聚焦同屏对照；未出现皇冠裁切、文字覆盖、横向溢出、下方控件重叠或交互入口失效。

## 实施检查清单

- [x] 仅修改交易购买页 VIP 月卡主视觉。
- [x] 保留全部 API、支付、状态与权益逻辑。
- [x] 通过针对性格式、lint、TypeScript 与 Web 生产构建检查。
- [x] 确认 Vercel Production 对应 Git commit `a9b4d5d` 且主视觉资源返回 HTTP 200。
- [x] 在 Telegram iOS 真机验证购买页渲染、摘要入口和关闭详情弹窗。
- [x] 完成用户参考、生成资产与真实实现的同屏视觉对照。

final result: passed
