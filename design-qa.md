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

# VIP 月卡皇冠与双权益真实素材验收

## 验收对象

- 版本：`24f8af6`
- 页面：交易 → 购买 → VIP MONTHLY PASS 横幅
- 页面状态：VIP 未开通、浅色主题、市场空状态
- 用户目标：保留现有三宠主图和布局，将皇冠、每日免费稀有盲盒蛋、每日 `100 Fgems` 水晶从简易线框图标改为与选定设计一致的真实暖金日漫游戏素材

## 视觉依据与证据

- 用户奖励素材参考：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-c7d76d11-a0df-467e-bc03-8a59e3aaa493.png`，`267 × 186px`
- 修正前截图：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-1d90587e-6e5e-4e84-b07f-e9c09df2ece5.png`，`159 × 68px`
- 最终真机截图：`/Users/mac/.codex/visualizations/2026/08/01/019fbd03-e1ea-7160-b00e-965e7909d203/vip-reward-assets-final-runtime.jpg`，`344 × 764px`
- 聚焦同屏对照：`/Users/mac/.codex/visualizations/2026/08/01/019fbd03-e1ea-7160-b00e-965e7909d203/vip-reward-assets-comparison.png`，`626 × 218px`；左侧为选定参考，右侧为最终真实页面卡片
- 项目素材：`vip-crown-medallion.webp`、`vip-rare-egg.webp`、`vip-fgems-crystal.webp`，均为 `384 × 384px` 独立 WebP 位图

## 视口与归一化

- 最终实现来自 Apple iPhone 镜像，完整画面为 `344 × 764px`；横幅裁切约为 `312 × 191px`。
- 参考图等比缩放至 `313px` 宽；实现横幅按真实卡片边界裁切后缩放至 `313 × 191px`，两侧补齐到同一 `313 × 218px` 画布再并排比较。
- 参考图只提供标题和奖励素材的美术语言，不是本项目完整横幅成稿；验收不把其缺少购买按钮和右侧三宠构图误判为实现偏差。

## 检查结果

- 皇冠已经由 Lucide 线框图标替换为金色王冠、月桂与圆形徽章组合；真实小尺寸下轮廓清晰，没有裁切或白色方框。
- 稀有盲盒蛋具有完整金色外框、琥珀核心和装饰底座；`100 Fgems` 使用独立切面水晶、金色光环与装饰底座，二者不再呈现为单线图标。
- 三张素材均使用与现有主图一致的奶油白、香槟金、琥珀橙和少量蜜桃色，没有引入紫色主调。
- 权益文字、手续费返还说明、真实价格、购买／续费／确认中状态及按钮交互保持原实现；未修改 API、后端、数据库或支付代码。
- 线上三个新资源均返回 HTTP `200`；关闭并重新打开 Telegram Mini App 后，真实 iPhone 页面已加载当前部署素材。
- `pnpm exec prettier --check`、`pnpm --filter @pokepets/web typecheck`、`pnpm --filter @pokepets/web build` 与 `pnpm assets:check:development` 均通过。

## Findings

没有发现可执行的 P0、P1 或 P2 视觉问题。

## 比较历史

1. 修正前只调整 CSS 并使用 Lucide 的蛋、宝石和皇冠线框图标，无法复现参考图中的立体金框、光晕和底座；用户指出该根因。
2. `24f8af6` 新增三张独立 ImageGen 位图并接入原组件，删除对应线框图标和为线框图标准备的颜色滤镜。
3. Telegram 首次进入交易页仍显示旧线框图标，确认是客户端旧包缓存；关闭并重新打开 Mini App 后加载新素材，真机对照通过。

final result: passed

---

# VIP 月卡固定标题与星际三宠主视觉验收

## 验收对象

- 版本：`e29a40ba89bd45cca17fe532637d0d6bd41a921c`
- 环境：Vercel Production `dpl_7ND8bWJ7i33QdCKM7MFEDZrkt5Dq`
- 页面状态：交易 → 购买、VIP 付款确认中
- 目标：主标题永久固定为“VIP 月卡”；付款、有效与过期状态只显示在副标题和按钮；更换为全新的三宠主视觉

## 视觉依据

- 用户问题截图：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-941fe086-7304-433e-9552-fd1315d153b8.png`，`200 × 50px`
- 最终 ImageGen 源图：`/Users/mac/.codex/generated_images/019fbd03-e1ea-7160-b00e-965e7909d203/exec-5d922018-e04a-4609-ba6b-6e5add631557.png`，`1448 × 1086px`
- 项目主视觉：`/Users/mac/Desktop/FinalTMA/apps/web/public/assets/vip/vip-membership-hero-v3.webp`，`1200 × 900px`
- 线上资源：`https://final-tma-pi.vercel.app/assets/vip/vip-membership-hero-v3.webp`，HTTP `200`，`image/webp`，`182746` bytes
- 实现截图：不可用；iPhone 镜像先显示“iPhone 使用中”，重连后显示“未找到 iPhone”。

## 已完成检查

- 源图已实际打开，确认包含金色狮兽、蓝色水龙和紫色电气兔三只原创宠物，左侧保留深蓝信息安全区。
- 部署已确认对应 Git commit `e29a40ba89bd45cca17fe532637d0d6bd41a921c` 且状态为 `READY`。
- 生产资源返回 HTTP `200`。
- 已在部署提交中核对组件：主标题唯一实现为 `<strong>VIP 月卡</strong>`；“付款确认中”“已生效”“已过期”只存在于副标题分支。
- `pnpm --filter @pokepets/web typecheck`、`pnpm --filter @pokepets/web build`、`pnpm assets:check:development` 与针对性 Prettier 检查通过。
- 该提交只包含 Web 主视觉资源、购买页样式与 `VipBanner.tsx`，没有修改 API、后端、数据库或支付代码。

## Findings

- [P1] 缺少真实 Telegram 实现截图
  - 位置：交易 → 购买 → VIP 月卡横幅。
  - 证据：源图和线上资源可访问，但 iPhone 镜像当前无法连接目标设备，因此无法把最终实现与源图放在同一比较图中。
  - 影响：无法完成字体、裁切、三宠可见度、状态副标题和按钮布局的真机视觉门禁。
  - 修复：目标 iPhone 回到 Mac 附近、最近解锁并重新锁定，恢复 iPhone 镜像后刷新 Mini App，捕获付款确认中状态并完成全页与聚焦对照。

## 比较历史

1. 用户截图显示旧实现把动态状态拼进主标题，出现“VIP 月卡付款确认中”。
2. `e29a40b` 把主标题改为固定“VIP 月卡”，把状态移入副标题，并替换为蓝紫星际三宠主视觉。
3. 当前部署、资源、代码与前端构建均已验证；真实设备截图因 iPhone 镜像连接失败尚未完成。

final result: blocked

---

# Battle 入场费房间卡片验收

## Findings

- 无可执行的 P0、P1 或 P2 视觉问题。
- [P3] 概念图中的宠物主体更靠近文字区；最终卡片为保证两项真实数值在 344px 真机宽度下清晰可读，将数值面板控制在左下区域，宠物主体集中在中右侧。三张图仍保持冰原、紫焰与赤金三个明确档位，未影响房间识别。

## 验收对象

- 当前有效版本：`d9d4234`
- 环境：Vercel Production `dpl_AewqeJx4FmDvaX2Ddc5HuCibu67h`，状态 `READY`，稳定别名 `final-tma-pi.vercel.app`
- 页面状态：Telegram iOS 真机、浅色主题、已登录、游戏首页、100 K-coin 默认选中
- 范围：只重设计“选择本场入场费”区域；档位、奖池、胜者到账、玩法、数据结构与原有 `onChooseTier` 流程保持不变；未修改 API、RPC、后端或数据库代码

## 视觉依据与实现证据

- 用户选定的房间设计：`/Users/mac/.codex/generated_images/019fbdc4-9d57-7a11-a937-488982a688bc/exec-9c137fe1-3fdb-41a1-959e-6269ccc38f25.png`，`853 × 1844px`
- 最终真机首屏：`/Users/mac/.codex/visualizations/2026/08/01/019fbdc4-9d57-7a11-a937-488982a688bc/battle-room-final-top.jpg`，`344 × 764px`
- 最终真机房间区与统一按钮：`/Users/mac/.codex/visualizations/2026/08/01/019fbdc4-9d57-7a11-a937-488982a688bc/battle-room-final-bottom.jpg`，`344 × 764px`
- 修复前遮挡证据：`/Users/mac/.codex/visualizations/2026/08/01/019fbdc4-9d57-7a11-a937-488982a688bc/battle-room-before-scroll-fix.jpg`，`344 × 764px`
- 全视图同屏对照：`/Users/mac/.codex/visualizations/2026/08/01/019fbdc4-9d57-7a11-a937-488982a688bc/battle-room-design-comparison.png`，`1120 × 1225px`；左侧为选定设计，右侧为最终真机首屏和底部状态
- 聚焦同屏对照：`/Users/mac/.codex/visualizations/2026/08/01/019fbdc4-9d57-7a11-a937-488982a688bc/battle-room-focused-comparison.png`，`1010 × 890px`；左侧为来源房间区域，右侧为最终三档房间与统一按钮

## 视口与归一化

- 实现截图来自 Apple iPhone 镜像，物理画面为 `344 × 764px`，包含镜像窗口与设备外框；镜像工具未暴露网页 CSS 视口和 `deviceScaleFactor`，因此不虚构 CSS 尺寸或像素密度。
- 全视图对照把 `853 × 1844px` 来源等比缩放至 `530px` 宽，把真机首屏等比缩放至 `530px` 宽，并在同一画布加入最终底部状态。
- 聚焦对照裁取来源图 `y=520–1844` 的房间区域并等比缩放到 `850px` 高；最终底部截图同样等比缩放到 `850px` 高。设备外框和 Telegram 原生控件只作为环境边界，不参与页面视觉差异判断。
- 来源概念图早于用户“删除平台费具体金额”的最终裁决，因此来源的第三项“平台费”不是当前视觉真相；最终实现按最新用户裁决只显示“双方奖池”和“胜者到账”。

## 必检保真面

- 字体与文案：沿用项目现有系统圆体回退、粗体档位数字和小字号指标层级；“每人入场”、三个 K-coin 档位、双方奖池、胜者到账和统一“选择队伍”按钮在真机清晰可读，没有截断。平台费标签和金额均不存在。
- 间距与布局：三张房间卡固定竖向排列，保持一致圆角、12px 间距、左下数值面板和右上选中标记；最终增加底部导航安全滚动空间，500 K-coin 卡片与统一按钮均可完整滚动到达。
- 色彩与状态：20 档使用冰蓝、100 档使用紫橙、500 档使用赤金；100 档默认出现橙色描边、阴影和勾选状态。20 与 500 卡片点击后立即切换选中标记，随后已恢复 100 默认状态。
- 图片质量：三张卡片均使用独立 `1200 × 560px` WebP 宠物对战位图，没有 CSS 宠物、手写 SVG、占位框、拉伸、白边或透明晕边；真机裁切保留对战双方和文字安全区。
- 图标与可访问性：勾选和统一按钮使用项目现有 Lucide 图标；房间使用原生 `button`，选中状态通过 `aria-pressed` 暴露，禁用条件继续复用加载中和已有参与状态。
- 交互与可信边界：20、100、500 三档只更新前端本地选择并即时反馈；统一按钮继续调用原有档位 ID 处理器，不在前端决定资产或结算结果。

## 比较历史

1. `3c4f8c3` 首次真实 Telegram 载入后，三张宠物场景、100 默认选中、20/500 即时切换和平台费移除均通过；但页面滚动到底时，固定底部导航遮住 500 档下方的统一按钮，记录为 P2 可达性问题。
2. `d9d4234` 为房间区域增加底部导航、安全区和 24px 的组合滚动留白；重新部署并关闭、重开 Mini App 后，最终底部截图显示三张竖向房间卡、100 选中状态和“选择队伍 · 100 K-coin”按钮完整位于底部导航上方。
3. 最终同屏全视图与聚焦对照未发现遗留 P0、P1 或 P2 问题；来源图中的平台费差异属于最新用户裁决，不是实现回归。

## Implementation Checklist

- [x] 20、100、500 三档保持原有数据映射并改为竖向宠物对战卡片。
- [x] 首次进入默认选中 100 K-coin，点击其他卡片即时切换前端状态。
- [x] 删除平台费标签和具体金额，只保留双方奖池与胜者到账。
- [x] 使用一个统一选择队伍按钮，并保证其在固定底部导航上方可滚动到达。
- [x] `pnpm exec prettier --check apps/web/src/domains/battle/ui/battle.css`、`pnpm --filter @pokepets/web build` 与 `pnpm assets:check:development` 通过。

## Follow-up Polish

- 无；本次只覆盖 Telegram 移动端入场费区域，桌面和平板不是当前视觉目标。

final result: passed

---

# VIP 月卡战队主视觉与紧凑购买按钮验收

## 验收对象

- 版本：`d4928f82d43cd3b69bf287705cd05c821c57033e`
- 环境：Vercel Production `dpl_DJRTP2mvrFTW7SPf8xsuPqhBSPVJ`，Telegram iOS 真机，iPhone 镜像
- 页面状态：交易 → 购买、浅色主题、已登录、VIP 未开通、市场空状态
- 用户结果：重做 VIP 主图、按钮与卡内布局；只改变前端，不改变 API、支付流程或后端裁决

## 视觉依据

- 用户最初布局参考：`/Users/mac/Desktop/图片/buy.png`，`941 × 1672px`
- 被替代实现截图：`/private/tmp/finaltma-vip-squad-pass2.png`，`344 × 764px`
- 最终 ImageGen 源图：`/Users/mac/.codex/generated_images/019fbd03-e1ea-7160-b00e-965e7909d203/exec-af51b28d-74c6-49f1-882d-e83084b95e11.png`，`1433 × 1098px`
- 项目最终主视觉：`/Users/mac/Desktop/FinalTMA/apps/web/public/assets/vip/vip-membership-hero-v2.webp`，`1200 × 900px`
- 真实环境实现截图：`/private/tmp/finaltma-vip-battle-pass3.jpeg`，`344 × 764px`
- 线上主视觉资源：`https://final-tma-pi.vercel.app/assets/vip/vip-membership-hero-v2.webp`，HTTP `200`，`image/webp`，`192650` bytes

## 视口与归一化

- iPhone 镜像实现截图为 `344 × 764px`；VIP 卡片可见区域约 `312 × 187px`，对应应用 `245px` CSS 高度在镜像窗口内的缩放结果。
- 全页对照将被替代实现与最终实现统一为 `344 × 764px`，左右并排生成 `708 × 764px` 比较图。
- 聚焦对照将 `1200 × 900px` 源图以居中 `cover` 归一化到 `624 × 374px`，并将真实实现中的 VIP 卡片裁切后归一化到相同尺寸，只判断宠物构图、主体可见度、左侧信息安全区和按钮布局。

## 对照证据

- 全页同屏对照：`/private/tmp/vip-pass-full-comparison.jpg`
- VIP 聚焦同屏对照：`/private/tmp/vip-pass-focused-comparison.jpg`
- 对照图均已实际打开检查；全页图验证卡片与筛选栏、市场空状态及底部导航的关系，聚焦图验证源图到真实卡片的裁切和 UI 叠加效果。

## 必查视觉面

- 字体与层级：沿用项目 SF/PingFang 系统栈；金色会员眉题、白色主标题、浅金状态说明、三项权益和底部价格形成明确层级。真机未见换行、遮挡或异常截断。
- 间距与布局：卡片继续保持 `245px` 高度；左侧信息列占 `48%`，三项权益使用稳定的纵向节奏；价格与购买按钮合并为单行操作区，按钮不再占满整列。
- 颜色与令牌：深棕玻璃面板、熔岩橙、金色与电光紫构成游戏通行证色彩；左侧暗色遮罩保证动态文案对比度，右侧保留宠物能量光效。
- 图片质量：使用独立 `WebP` 位图而非 CSS 绘图；三只原创宠物均可辨认，火焰主宠、雷电伙伴和水晶幼宠没有被边缘裁断；真机未见拉伸、透明边缘、压缩色块或模糊占位。
- 文案与业务内容：继续显示真实 `199 Stars · 30 天`、每日 `100 Fgems`、每日免费稀有盲盒、交易手续费返还及动态购买/续费状态；主图不固化任何价格和状态文案。
- 按钮与交互：购买按钮固定为短尺寸游戏按钮，与价格同排；未开通状态显示完整“购买”。点击卡片摘要立即打开原 VIP 详情弹窗，关闭后回到购买页；未点击弹窗中的真实 `199 Stars` 购买按钮。
- 可访问性：装饰图继续使用空 `alt` 与 `aria-hidden`；摘要和购买入口继续使用语义按钮；原禁用、焦点和前端即时反馈逻辑未改变。

## Findings

没有发现可执行的 P0、P1 或 P2 视觉问题。

当前真实账号只覆盖未开通状态；加载失败、确认中、续费与续费上限状态未通过伪造接口或修改真实数据进行截图。所有状态继续使用原组件逻辑，价格槽允许省略显示，按钮为长状态文案保留到 `92px` 的自适应宽度。

## 比较历史

1. 第一版多宠横幅高度为 `184px`，雷电伙伴被信息区遮挡，主体数量不清晰。
2. 第二版把卡片提高到 `245px` 并完整展示三只宠物，但购买按钮横向铺满左栏，视觉重量过大，用户明确否决。
3. 最终版重新生成战斗竞技场主图，使用右侧三宠冲锋构图和左侧深色游戏面板；价格与 `62px` 起的短按钮并排，真实 Telegram iOS 同屏对照中不存在宠物裁切、按钮过长、文字覆盖或横向溢出。

## 实施检查清单

- [x] 只修改 Web 前端主视觉资源、VIP 组件资源引用和购买页样式。
- [x] 未修改 `apps/api`、API contract、数据库、支付或 VIP 后端逻辑。
- [x] `pnpm --filter @pokepets/web typecheck` 通过。
- [x] `pnpm --filter @pokepets/web build` 通过。
- [x] `pnpm assets:check:development` 通过。
- [x] Vercel Production 已确认部署 Git commit `d4928f82d43cd3b69bf287705cd05c821c57033e` 且别名已指向 READY 部署。
- [x] Telegram iOS 真机验证购买页渲染、VIP 详情打开和关闭；没有执行真实付款。

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

---

# VIP 月卡暖橙金三宠主视觉验收

## 验收对象

- 版本：`1d067731a669ba587ca7deeab96509a23435a865`
- 页面：交易 → 购买 → VIP 月卡横幅
- 目标：将蓝紫星际主视觉替换为暖橙金日漫三宠主视觉，且保留固定“VIP 月卡”标题、紧凑购买按钮及全部原有业务交互。

## 视觉依据

- 最终 ImageGen 源图：`/Users/mac/.codex/generated_images/019fbd03-e1ea-7160-b00e-965e7909d203/exec-7dd2da4c-7ead-44f6-9c78-65f17d1568dd.png`，`1448 × 1086px`
- 项目主视觉：`/Users/mac/Desktop/FinalTMA/apps/web/public/assets/vip/vip-membership-hero-v4.webp`，`1200 × 900px`
- 实现截图：不可用；iPhone 镜像仍无法连接目标设备。

## 已完成检查

- 源图已实际打开：三只原创宠物分别为琥珀叶饰白狐、少量青绿点缀的小龙与花饰白兔；画面以奶油白、琥珀橙和金色为主，无紫色主调。
- 组件仍将主标题硬编码为 `<strong>VIP 月卡</strong>`；付款、有效期及过期状态仍只出现在副标题和原有按钮逻辑中。
- 卡片继续保持 `245px` 高度、左侧信息区与短购买按钮布局；仅将卡片遮罩、文字、权益块和图标颜色切换为暖色令牌。
- `pnpm --filter @pokepets/web typecheck`、`pnpm --filter @pokepets/web build`、`pnpm assets:check:development` 和针对性 Prettier 检查通过。
- 本次提交只修改 Web 主视觉资源、资源引用和购买页 CSS；没有修改 API、后端、数据库或支付代码。

## Findings

- [P1] 缺少真实 Telegram 实现截图
  - 位置：交易 → 购买 → VIP 月卡横幅。
  - 证据：主视觉源图、组件和静态构建均已检查，但 iPhone 镜像当前无法连接，无法取得与源图同视口、同状态的实现截图。
  - 影响：无法完成真机上的裁切、文字对比度、左侧信息区与短按钮间距的同屏视觉对照。
  - 修复：恢复 iPhone 镜像连接后，刷新 Mini App 的购买页，捕获未开通状态的全页与 VIP 卡聚焦截图，再进行同屏比较。

final result: blocked

---

# VIP MONTHLY PASS 奖励卡与双行购买按钮验收

## 验收对象

- 版本：`4b7b145`
- 页面：交易 → 购买 → VIP 月卡横幅
- 页面状态：用户选定的未开通月卡视觉；购买价格由真实 `vip.get` 响应提供
- 用户结果：保留暖橙金三宠主图；固定英文标题 `VIP MONTHLY PASS`；突出每日免费稀有盲盒和每日 `100 Fgems`；将手续费返还作为辅助权益；购买入口采用开盒“开 10 次”同款暖橙双行大圆角按钮

## 视觉依据

- 用户选定视觉：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-a3c9d9fc-4be9-4682-96d8-c5309ae2acb4.png`，`848 × 412px`
- 保留主图：`/Users/mac/Desktop/FinalTMA/apps/web/public/assets/vip/vip-membership-hero-v4.webp`，`1200 × 900px`
- 实现截图：不可用；当前没有可打开的同状态 Telegram 实现截图。

## 实现核对

- 标题唯一实现为硬编码 `<strong>VIP MONTHLY PASS</strong>`，不再读取付款、有效期或续费状态。
- 两张奖励卡分别使用蛋图标的“每日免费 / 稀有盲盒”和宝石图标的“每日 / 100 Fgems”；交易手续费返还单独作为次级说明，不被表述为每日奖励。
- 购买入口保留原来的禁用、重新加载与打开 VIP 详情交互；按钮主文案随真实状态显示购买、确认中、续费或重新加载，副文案显示真实价格、剩余天数或加载错误。
- 未修改 API、后端、支付、数据库或主视觉资源。
- `pnpm exec prettier --check apps/web/src/domains/vip/ui/VipBanner.tsx apps/web/src/domains/market/ui/market-density.css`、`pnpm --filter @pokepets/web typecheck`、`pnpm --filter @pokepets/web build` 与 `pnpm assets:check:development` 均通过。

## 对照状态

- 源截图包含聊天界面与设计卡片，源文件尺寸为 `848 × 412px`；卡片内的应用区域没有可可靠复用的独立实现视口规格。
- 当前没有新实现截图，无法获得实现像素尺寸、CSS 视口或设备像素比，因此未进行密度归一化、全页同屏对照或聚焦区域对照。

## Findings

- [P1] 缺少同状态的 Telegram 实现截图
  - 位置：交易 → 购买 → VIP 月卡横幅。
  - 证据：已打开用户选定的源视觉并完成前端静态构建，但没有当前提交的 Telegram 页面截图。
  - 影响：无法针对标题字重、双奖励卡密度、主图裁切与双行按钮宽度完成 1:1 视觉门禁。
  - 修复：在 Telegram iOS 真实未开通状态打开购买页，捕获完整页面和 VIP 横幅聚焦截图，再与选定视觉同屏比较。

## 比较历史

1. 旧版使用固定中文标题、纵向权益列表与价格、按钮分列布局，不符合用户选定的双奖励卡与双行购买按钮方案。
2. `4b7b145` 固定英文标题，将付款和续费状态移入操作按钮；保留三宠主图，仅调整前端布局与样式。
3. 静态检查已通过；尚缺真实 Telegram 截图，因此视觉比较不能标记为通过。

final result: blocked

---

# VIP MONTHLY PASS 视觉复刻修正验收

## 验收对象

- 版本：`7c55261`
- 页面：交易 → 购买 → VIP 月卡横幅
- 页面状态：VIP 未开通、浅色主题、市场空状态
- 修正目标：以用户选定的设计卡为唯一视觉依据，复刻三宠主图可见度、左侧标题比例、蛋与宝石奖励主体、手续费返还说明和左对齐双行购买按钮

## 视觉依据

- 用户选定设计卡：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-a3c9d9fc-4be9-4682-96d8-c5309ae2acb4.png`，`848 × 412px`
- 修正前真实实现：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/com.openai.sky.CUAService/iPhone镜像 Screenshot 2026-08-01 at 10.29.24 PM.jpeg`，`344 × 764px`
- 修正后实现截图：不可用；提交推送后，iPhone 镜像已切换到其他 App，未在用户正在使用设备时强行导航或刷新。

## 已确认的修正

- 购买页主图文件保持不变；仅降低左侧遮罩并调整裁切基准，使右侧三宠更接近设计卡的明亮构图。
- 左侧内容列从 `53%` 收回至 `50%`；皇冠、英文标题和会员眉题按设计卡放大。
- 两项权益由白色大卡改为金色蛋／宝石主体加独立小标签，文案分别固定为“每日免费稀有盲盒”和“每日 100 Fgems”。
- 手续费返还维持次级说明，不伪装为每日奖励。
- 购买按钮宽度改为内容列的 `90%`，保留“开 10 次”同款暖橙双行层级以及原有真实价格、续费、确认中和重新加载逻辑。
- 本次仅修改 `VipBanner.tsx` 与购买页 CSS；未修改主图、API、后端、支付或数据库。
- `pnpm exec prettier --check apps/web/src/domains/vip/ui/VipBanner.tsx apps/web/src/domains/market/ui/market-density.css`、`pnpm --filter @pokepets/web typecheck`、`pnpm --filter @pokepets/web build` 与 `pnpm assets:check:development` 均通过。

## 对照状态

- 修正前截图与设计卡均已实际打开检查：修正前的权益为两块大白卡、按钮横向偏长、主图被过度遮罩，与设计卡存在 P1 偏差。
- 修正后页面尚无同状态、同设备的实际截图，无法完成尺寸归一化、同屏全页比较和 VIP 横幅聚焦比较。

## Findings

- [P1] 缺少 `7c55261` 的真实 Telegram 实现截图
  - 位置：交易 → 购买 → VIP 月卡横幅。
  - 证据：源视觉、修正前真机截图、前端改动和生产构建均已检查；自动部署已由 GitHub 推送触发，但修正后截图未取得。
  - 影响：无法确认新的主图裁切、奖励主体、标题间距和购买按钮是否在真实 iPhone 视口达到设计卡比例。
  - 修复：用户回到 PokePets 的交易 → 购买页并刷新后，捕获同一未开通状态的全页与横幅聚焦截图，再与设计卡同屏比较。

## 比较历史

1. `4b7b145` 将布局改为双奖励卡和双行按钮，但真实截图显示奖励卡过于矩形、按钮过宽，且主图遮罩过重。
2. `7c55261` 将权益改为图标主体加标签、收窄按钮与左侧内容列，并恢复右侧三宠主图可见度。
3. 修正后的静态检查通过；真实设备在刷新前切换到其他 App，因此不能将视觉验收标记为通过。

final result: blocked

---

# 当前最终验收结论

- 当前有效版本：`7c55261`
- 当前有效验收：本文“VIP MONTHLY PASS 视觉复刻修正验收”章节。
- 代码与静态构建已经验证；修正后的真实 Telegram 截图尚未取得，因此视觉验收待补。
- 历史皇冠版、旧多宠版、蓝紫星际版、旧暖橙金布局与第一次双奖励卡布局仅保留为比较记录，不再作为当前视觉方案。

final result: blocked

---

# 开盒页圆润盲盒、月卡领取与奖池布局验收

## Findings

- 无可操作的 P0、P1 或 P2 视觉问题。
- [P3] 用户提供的开盒主图是同风格参考，不是本项目的逐像素成稿；本次保留既有价格、奖池数据、导航和交互，只对用户点名的盲盒素材、领取入口和奖池预览层级进行匹配。

## 验收对象

- 版本：`bbf9319`
- 页面：开盒页，浅色主题、真实 Telegram iPhone 镜像。
- 状态：普通盲盒选中；额外切换并捕获稀有、传说盲盒。未触发开盒、领取或支付。
- 范围：仅前端布局、样式与三张静态盲盒图；未改动 API、RPC、后端、支付、数据库或奖池玩法。

## 视觉依据与截图

- 开盒构图来源：`/Users/mac/Desktop/图片/开盒.png`，`941 × 1670px`。
- 磨砂质感来源：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-54bb3f72-87ff-4f22-b07b-3f7bab30682d.png`，`481 × 577px`。
- “可能获得”标题来源：`/var/folders/__/ffcc9r1113l4c8cd1z4m8tp80000gn/T/codex-clipboard-0bf73963-26b7-4990-a1a5-b0a0584f420e.png`，`64 × 21px`。
- 最终普通盲盒实机截图：`/Users/mac/.codex/visualizations/2026/08/01/019fbdb3-256c-72b1-8734-27ed7d80bb6a/gacha-normal-final-runtime.png`，`344 × 764px`。
- 最终稀有盲盒实机截图：`/Users/mac/.codex/visualizations/2026/08/01/019fbdb3-256c-72b1-8734-27ed7d80bb6a/gacha-rare-final-runtime.png`，`344 × 764px`。
- 最终传说盲盒实机截图：`/Users/mac/.codex/visualizations/2026/08/01/019fbdb3-256c-72b1-8734-27ed7d80bb6a/gacha-legendary-final-runtime.png`，`344 × 764px`。
- 全页同屏对照：`/Users/mac/.codex/visualizations/2026/08/01/019fbdb3-256c-72b1-8734-27ed7d80bb6a/gacha-visual-qa-final-comparison.png`，`800 × 970px`；左上为开盒参考裁切，左下为磨砂来源，右侧为最终实机页面。
- 聚焦对照：`/Users/mac/.codex/visualizations/2026/08/01/019fbdb3-256c-72b1-8734-27ed7d80bb6a/gacha-visual-qa-focused-comparison.png`，`760 × 650px`；上排核对“可能获得”，下排核对磨砂领取卡。

## 视口与归一化

- 实现截图来自 Apple iPhone 镜像，物理画面为 `344 × 764px`，包含镜像窗口与设备外框；镜像工具未暴露网页 CSS 视口和 `deviceScaleFactor`，因此未虚构 1:1 CSS 尺寸。
- 参考图与实现不是同一产品成稿、盲盒档次或设备外框，比较只用于用户指定的三处组件，不能作全页像素级差分。
- 全页对照将开盒参考裁切 `760 × 1120px` 缩放为 `380 × 560px`，磨砂来源缩放为 `300 × 360px`，实机截图等比缩放为高 `800px`；聚焦对照分别放大真实标题和两张领取卡，消除小尺寸阅读误差。

## 必检保真面

- 字体与文案：星标“可能获得”与“查看全部”形成单行层级，已删除易拥挤的概率摘要；现有盲盒名称、价格、奖池稀有度和按钮文案保持真实数据来源。
- 间距与布局：五个候选物改为等宽紧凑网格，真实 `344px` 视口中未挤压底部导航、保底条或抽取按钮；英雄盲盒、三档选择卡和候选栏保持清晰垂直分组。
- 色彩与表面：领取入口为半透明白、白色描边、柔和阴影与背景模糊；保留项目的暖橙激活色，不新增皇冠入口。
- 图片质量：普通、稀有、传说蛋均为 `1254 × 1254px` 的透明 WebP；实机三档切换中没有白边、透明晕边、拉伸或裁切，轮廓均为宽底圆润造型。
- 图标与可访问性：使用项目既有 Lucide 星标、宝石和礼物图标；两个权益仍是带原有 `aria-label` 的真实按钮，错误重试入口保留在这两个按钮中；未用 CSS 或手写 SVG 伪造素材。

## 比较历史

1. 首次真实页面对照发现概率摘要在“可能获得”标题旁形成细小噪点，属于 P1 信息密度偏差；在 `bbf9319` 中移除了该显示项，并将标题与“查看全部”调整为两端布局。
2. 首次部署后 Telegram 保留了旧的 Mini App 包，截图仍显示皇冠入口；关闭并重新打开 Mini App 后加载当前生产包，最终截图只显示两个领取按钮。该现象为客户端旧包缓存，不是当前提交的结构残留。
3. 重新打开后的普通、稀有、传说三档均已在真实 iPhone 页面切换核对；全页和聚焦对照中没有遗留 P0/P1/P2 问题。

## Implementation Checklist

- [x] 三档盲盒替换为圆润、宽底、透明背景的 WebP 素材，并保持原有档次映射。
- [x] 删除月卡领取入口皇冠，只保留 Fgems 和免费稀有盲盒两张磨砂领取卡。
- [x] “可能获得”收敛为星标标题、查看全部入口和整齐候选物网格。
- [x] 生产构建通过：`pnpm --filter @pokepets/web typecheck`、Prettier、`pnpm --filter @pokepets/web build`；资产锁定检查通过。

## Follow-up Polish

- 无；桌面或平板不属于本次 Telegram 移动端参考与改动范围。

final result: passed

---

# VIP 月卡皇冠与双权益真实素材验收结论

- 该次验收版本：`24f8af6`
- 该次验收记录：本文“VIP 月卡皇冠与双权益真实素材验收”章节。
- 三张真实暖金位图已经在 Telegram iOS 真机加载，并完成参考与实现同屏比较；旧版 `7c55261` 的截图阻塞结论已被本次真实验收取代。

final result: passed

---

# VIP 月卡紧凑双权益图标验收

## 验收对象

- 版本：`bc583cc`
- 页面：交易 → 购买 → VIP MONTHLY PASS 横幅
- 用户裁决：只重新生成两枚透明背景权益图标，保留现有卡片、标签、文案、布局和业务交互。
- 改动范围：仅替换 `vip-rare-egg.webp` 与 `vip-fgems-crystal.webp`；未修改组件、CSS、API、后端、支付或数据库。

## 唯一设计方案

- 两枚图标统一为奶油白、香槟金和琥珀橙的紧凑 3D 日漫游戏素材；稀有盲盒使用象牙白蛋壳、琥珀核心和小型冠饰，`Fgems` 使用单枚对称切面水晶。
- 删除旧图标的大光环、花枝、丝带和外扩底座。主体只占正方形画布上方区域，底部固定保留透明安全区，供现有 `-8px` 标签叠层进入而不遮挡图标主体。
- 两个项目成品均为 `384 × 384px` 透明 WebP；稀有盲盒蛋 SHA-256 为 `82ed7df02b06d5ed6318b27d942e96b2d371ffd886e5b40f11e1eb6caef15adf`，Fgems 水晶 SHA-256 为 `6915c4e9e708a10cacc942a5ca1e54f07a8ae2bd5f57ee5ddc6b079cf63f3fd1`。

## 生成与验证证据

- 使用内置 ImageGen 分别生成两枚独立素材，以纯色绿幕输出并通过项目配置的共享图像运行环境移除背景；没有使用 CLI 模型降级或原生透明回退。
- ImageGen 源图：`/Users/mac/.codex/generated_images/019fbe02-41c1-7d13-a727-d99f648ab69a/exec-60962785-1ace-4441-a8a0-508c7cdfda50.png` 与 `/Users/mac/.codex/generated_images/019fbe02-41c1-7d13-a727-d99f648ab69a/exec-58855581-e96e-4d6a-8f70-60d0e0d3833b.png`，均为 `1254 × 1254px`。
- 透明化后四角 Alpha 均为 `0`；蛋主体 Alpha 包围盒为 `(322, 30)–(931, 899)`，水晶主体为 `(382, 99)–(872, 926)`，两者底部均留有超过 25% 画布高度的完全透明区域。
- `pnpm assets:check:development` 通过：425 个开发发布资产均路径有效、格式有效、哈希锁定且已被构建收录。
- 提交已推送至 `origin/main` 并触发自动部署；线上两个资源的 SHA-256 与本地成品完全一致。

## 真实页面状态

- 普通浏览器正确显示“请从 Telegram Mini App 打开应用”，因此没有伪造 Telegram 身份或使用浏览器页面代替真机验收。
- 自动部署后曾连接真实 iPhone 镜像；切换交易页时设备开始被直接使用，镜像按系统规则结束，未取得本次提交后的横幅截图，也未点击购买、领取或支付。
- 资产透明边界、主体占位和线上字节已通过，但真实 Telegram 横幅中的最终视觉叠压仍需在设备空闲后补一张同状态截图确认。

final result: blocked

---

# VIP 月卡紧凑双权益图标验收结论

- 该次验收版本：`bc583cc`
- 该次验收记录：本文“VIP 月卡紧凑双权益图标验收”章节。
- 两枚紧凑透明图标已经生成、接入、通过资产门禁并部署到真实环境；旧版带光环、花枝和底座的双权益素材已被替代。
- 当前唯一待补证据是部署后真实 Telegram 购买页截图；在取得该截图前，不把页面级视觉验收标记为通过。

final result: blocked

---

# VIP 月卡纵向双权益标签验收

## 验收对象

- 版本：`37d091c`
- 页面：交易 → 购买 → VIP MONTHLY PASS 横幅
- 用户裁决：两项权益整体纵向排列，每行为「左侧图标、右侧文字」；上方显示金色礼盒和「每日免费盲盒」，下方显示橙色切面宝石和「每日 100 Fgems」；每行保留独立浅金色描边圆角标签。
- 改动范围：VIP 横幅组件、交易购买页样式、两张新增透明 PNG 和月卡展示文档；未修改 API、后端、支付、领取裁决或数据库。

## 唯一实现结果

- 原横向双图标与叠加牌匾已替换为纵向两行独立标签；两行均使用 `28px` 图标列、右侧单行文案、浅金背景和金色描边。
- 交易手续费返还继续显示在两行每日权益下方，购买、续费、确认中、重新加载和实时价格逻辑保持不变。
- 「每日免费盲盒」仅是横幅简化文案，真实权益仍为功能文档定义的每日 1 条免费稀有盲盒资格。

## ImageGen 素材证据

- 使用用户指定的内置 `$imagegen` 路径分别生成两枚素材，均以纯色绿幕输出，再使用共享图像运行环境和 `remove_chroma_key.py` 移除背景；未使用 CLI 模型回退。
- 礼盒生成源图：`/Users/mac/.codex/generated_images/019fbe1c-3287-7441-9b33-f2b560bac911/exec-acd535fb-c026-4d48-a513-d0d3abafa659.png`。最终成品：`apps/web/public/assets/vip/vip-daily-gift.png`，`384 × 384px` RGBA，Alpha 包围盒 `(67, 59)–(312, 322)`，四角 Alpha 均为 `0`，SHA-256 为 `03e263e3cab0dcbfd8f5e6677ecef39de4ad122a40d2af33863e21a894fd5512`。
- 宝石生成源图：`/Users/mac/.codex/generated_images/019fbe1c-3287-7441-9b33-f2b560bac911/exec-ea6806c0-bae8-476b-840c-d925d76eb49d.png`。最终成品：`apps/web/public/assets/vip/vip-daily-fgems.png`，`384 × 384px` RGBA，Alpha 包围盒 `(45, 32)–(339, 342)`，四角 Alpha 均为 `0`，SHA-256 为 `22ea1d7f109ba4baf4e5b052b351855485060599732635936ff60bc984c7b940`。
- 礼盒提示词固定为单个奶油白与香槟金礼盒、琥珀橙色缎带、紧凑 3D 日漫游戏图标、纯 `#00ff00` 背景，禁止文字、投影、地面和多余装饰。
- 宝石提示词固定为单枚对称橙色切面宝石、香槟金外框、紧凑 3D 日漫游戏图标、纯 `#00ff00` 背景，禁止文字、底座、投影和多余光效。

## 验证证据

- `pnpm exec prettier --check apps/web/src/domains/vip/ui/VipBanner.tsx apps/web/src/domains/market/ui/market-density.css` 通过。
- `pnpm --filter @pokepets/web build` 通过。
- `pnpm assets:check:development` 通过：425 个开发发布资产全部路径有效、格式有效、哈希锁定且已进入构建。
- `APP_ENV=development pnpm build` 通过：API contracts、API、Web、API 类型、资产和构建 TON Connect manifest 能连续产出。
- 提交 `37d091c` 已推送到 `origin/main` 并触发自动部署；线上两张 PNG 的 SHA-256 与本地成品完全一致。
- 真实 iPhone 镜像在 Telegram Mini App 重新加载后完成 `344 × 764px` 交易购买页验收；两行标签顺序、图标、文案、边框和底部次级权益均正确，未见换行、遮挡或溢出。
- 真机截图：`/Users/mac/.codex/visualizations/2026/08/01/019fbe1c-3287-7441-9b33-f2b560bac911/vip-market-vertical-benefits-live.jpg`，SHA-256 为 `ca4580e11305ac62d44dcde69c80423a677e3399c37ce99d5294db20c9a4abcf`。验收过程只导航和重新加载页面，未点击购买、领取或支付。

final result: passed

---

# 当前 VIP 最终验收结论

- 当前有效版本：`37d091c`
- 当前有效验收：本文「VIP 月卡纵向双权益标签验收」章节。
- 纵向两行权益、两枚透明 PNG、线上资源字节和真实 Telegram iPhone 布局均已验收通过；旧横向双图标与叠加牌匾方案只保留为历史记录。

final result: passed

---

# 三档盲盒用户指定素材替换

## 验收对象

- 页面：开盒页主盲盒与三档选择缩略图。
- 用户裁决：从左到右固定为白金蛋＝普通盲盒、黑橙蛋＝稀有盲盒、金色花纹蛋＝传说盲盒；第三张源图先移除绿色背景再接入。
- 改动范围：只替换 `normal.webp`、`rare.webp`、`legendary.webp` 并刷新资产哈希锁；未修改组件、CSS、API、后端、价格、奖池或数据库。

## 唯一实现结果

- 普通与稀有盲盒直接使用用户提供的透明 PNG 源图编码为项目现用透明 WebP。
- 传说盲盒对用户提供的原始 RGB PNG 执行色键抠图，保留完整蛋体、金色椭圆框、花叶、水晶装饰、环形装饰和底座；最终透明图四角 Alpha 均为 `0`，透明包围盒为 `(19, 37)–(1106, 1383)`，未检测到可见绿色主导像素。
- 主图与缩略图继续共用 `GachaView` 中同一组档次资源路径，因此三张资源替换后两处同步生效。
- 成品 SHA-256：普通盲盒 `183f83bd5e0c51f6be6ef9045f66481aec848b484720d4f3c683518ba6e051ae`；稀有盲盒 `fb2d1ddab64625f624f774b44a39f62db1b1be4dadc04d7e590ef0b3c8954ad5`；传说盲盒 `5bc0cc7ad004d9e30f4112340c2e116f0f94f98ec71ea32779bd01ce7e8576ab`。

## 验证证据

- `pnpm --filter @pokepets/web build` 通过。
- Web 构建刷新发布目录后，`pnpm assets:check:development` 通过：425 个开发发布资产全部路径有效、格式有效、哈希锁定且已进入构建。
- 未执行本地功能测试，未触发开盒、领取、支付或资产变更。

final result: passed

---

# 藏品页单屏布局 Design QA

## 对比目标

- 设计来源：用户提供的参考图“藏品.png”，945×1670 px。
- 用户问题证据：用户提供的功能区局部图，176×252 px；选择区局部图，314×58 px。
- 真实实现截图：iPhone 镜像中的真实生产页面，344×764 px。
- 完整并排证据：本次验收生成的 764×800 px 临时对比图，不进入仓库。
- 局部问题证据：本次验收生成的 820×660 px 临时对比图，不进入仓库。
- 状态：Telegram Mini App 藏品页，选中“炭尾狐”，显示 4×2 藏品选择区、顶部资产栏和底部导航。
- 视口：iPhone 镜像截图包含设备框，实际设备屏幕在截图中约为 330×716 px；镜像未暴露 WebView 的 CSS 像素密度，因此不虚构 density。实现使用 Telegram 稳定视口变量并以 667px 高度作为 CSS 压缩下限。
- 归一化：完整对比中设计来源等比缩放至 380px 宽，真实截图保持 344px 宽；只比较应用内容的结构、边界、层级和密度，不把设备框、Telegram 顶部资产栏或底部导航差异判定为设计偏差。

## 完整视图结论

参考图的“左侧信息与操作、右侧独立主形象、底部四列选择区”层级已保留。主形象继续以右侧网格列中心和底部作为锚点，资源、显示尺寸和位置不变，但右侧列的左边界不再裁掉透明素材中的宠物像素；依据用户最新裁决，左侧名称、属性和四个操作入口删除自身填充背景、圆角边框与阴影，只保留文字、图标、触控区域和既定排列，并位于主图上层。底部选择区通过独立分隔线与详情区分开，两个区域没有边界重叠。

真实 iPhone 镜像执行一次向下滚动手势后页面位置未变化，顶部资产栏、详情、4×2 选择区和底部导航仍同时完整可见，符合页面禁止纵向滚动的裁决。

## 局部对比结论

局部对比用于检查用户指出的两个问题，因此需要单独证据：

1. 原页面的主图通过负边距扩张到左侧操作区；修复后主图容器宽度固定为右侧网格列的 100%，负边距归零，操作区与主图之间保持网格间距。
2. 原选中卡片使用 `translateY(-3px)`，在 `overflow-y: hidden` 的横向容器内造成顶部边框裁切；修复后取消纵向位移，并在选择区顶部增加独立内边距和分隔线。

## 必查视觉面

- 字体与排版：保留项目既有字体、字重、字号层级和中文文案；短屏仅通过受控 `clamp()` 缩放，不产生换行或截断。
- 间距与布局节奏：详情与选择区边界清晰；主图、左侧功能区和缩略图区均处于独立网格轨道；当前真实设备无覆盖、裁切或纵向滚动。
- 颜色与视觉变量：继续使用项目既有橙白主题、边框、阴影和状态颜色，没有引入新的视觉体系。
- 图片质量与素材：继续使用正式 768×768 藏品详情图和 256×256 缩略图；主图只改变容器裁切边界，没有替换、拉伸或生成素材。
- 文案与内容：名称、稀有度、阶段、战斗力、数量、进化、分解、出售、Mint、图鉴和导航文案全部保留。

## 对比历史

### 第一次证据

- P1：主图负边距与跨行网格使图片进入左侧功能模块。
- P1：选中缩略图向上位移，被横向选择容器裁切并与上方边界重叠。
- P2：固定 510px 最小高度不能适配 667px 矮屏，存在页面超出稳定视口的风险。

### 已实施修复

- 页面高度改为 Telegram 稳定视口扣除顶部栏、底部导航和安全区后的唯一可用高度，并禁止纵向溢出。
- 主图取消负边距与超宽扩张，只占右侧网格列。
- 名称、属性、数量、按钮和缩略图尺寸按动态视口高度连续缩放。
- 选择区增加独立分隔与顶部内边距，选中态取消纵向位移。

### 修复后证据

- 主图允许越过右侧列的左边界显示完整宠物像素，功能文字、图标和触控区域保持在主图上层。
- 选择区顶部边框、选中卡片边框和详情区分隔线均完整可见。
- 向下滚动手势后画面位置不变，固定导航和全部藏品内容保持单屏可见。

## Findings

没有剩余 P0、P1 或 P2 视觉问题。

## Open Questions

无。

## Implementation Checklist

- [x] 主图保持右侧锚点与既定尺寸，但不按右侧列左边界裁切宠物像素。
- [x] 左侧名称、属性和功能按钮不使用填充背景、圆角边框或阴影。
- [x] 选择区与详情区边界分离。
- [x] 选中卡片不越界、不裁切。
- [x] 页面禁止纵向滚动。
- [x] 667px 高度使用连续压缩尺寸。

## Follow-up Polish

无阻塞性交付项。

final result: passed
