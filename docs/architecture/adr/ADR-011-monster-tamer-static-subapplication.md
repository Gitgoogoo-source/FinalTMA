# ADR-011：Monster Tamer 独立静态子应用

## 状态

已接受。

## 背景

产品第 21 章要求在现有游戏页新增 Monster Tamer，同时保持 Expedition 与 Wheel 不变。Monster Tamer 保留上游固定提交的完整单机玩法，但不属于 FinalTMA 的账号、资产、藏品、奖励或交易体系。

把游戏源码导入 React bundle、复用 FinalTMA session 或接入 API 会扩大可信边界，并让本地随机结果与业务资产产生错误关联。移动 Telegram WebView 又必须具备触控、安全区、返回和音频解锁能力。

## 决策

Monster Tamer 固定作为同一 Vercel Web 部署中的公开独立静态子应用：

1. 完整运行树位于 `apps/web/public/monster-tamer`，入口固定为 `/monster-tamer/`。
2. `/monster-tamer` 与 `/monster-tamer/` 在 SPA catch-all 前重写到独立 `index.html`。
3. `apps/web/src/domains/monster-tamer` 只渲染启动卡片，并以普通链接打开静态入口。
4. 游戏页组合顺序固定为 `MonsterTamerPanel → ExpeditionPanel → WheelPanel`。
5. 静态子应用不导入 React 应用、API 契约或业务领域，不读取 FinalTMA session、Telegram `initData`、业务资产、Catalog 或数据库。
6. 唯一持久化键为 `MONSTER_TAMER_DATA`；所有游戏进度和随机结果仅属于当前浏览器本地存档。
7. Phaser 3.60.0、Web Font Loader 1.6.28、Tweakpane 4.0.3 与许可证全部本地发布。
8. 世界场景把地图点击或拖动坐标经当前相机转换并吸附到 64px 网格，角色逐格朝最后触点移动，到达目标或遇到碰撞后停止；A、B、菜单继续进入游戏自身 Controls 抽象，非世界菜单使用直接点击或滑动选择，并在 pointer cancel、失焦、Telegram 停用和页面隐藏时清空移动目标与输入。
9. Telegram SDK 只处理 ready、expand、原生 fullscreen、稳定视口、安全区、垂直滑动保护和 BackButton；原生全屏不支持时回退到已展开稳定视口，普通浏览器使用页面返回链接并保留键盘 `F` 全屏。
10. 战斗场景固定保留底部 128 逻辑像素菜单区；敌方怪兽位于剩余战场的右上区域，我方怪兽位于左下区域，怪兽、血条、队伍标记、训练师、攻击特效与捕捉球统一从当前逻辑视口计算坐标并响应 resize。进入战斗时记录世界相机 zoom，正常结束或全队倒下返回恢复点时复用该 zoom，禁止按恢复点地图高度重新放大。
11. 上游 MIT 许可证、运行库许可证和第三方 notices 随静态树发布。无逐文件直接授权证据的画面在公开发布前按相同路径、尺寸和帧契约替换为项目原创画面。

## 边界

Monster Tamer 不拥有 API route、OpenAPI schema、Function、环境变量、Supabase schema、RPC、migration、operation、ledger、reservation 或 recovery workflow。FinalTMA 不读取本地游戏存档，也不把游戏内怪物、道具、战斗、捕捉或经验映射为藏品、Fgems、K-coin、任务或奖励。

Catalog v1 product-data checksum boundary 位于产品第 21 章之前。第 21 章不改变 Catalog v1 immutable release identity，不生成或修改目录 manifest 与 product-data migration。

## 结果

静态游戏可以独立加载、保存和回滚，FinalTMA 业务安全不依赖其客户端正确性。发布门禁必须验证静态目录完整、launcher 纯链接、路由优先级、业务引用为零、许可证存在和游戏页顺序；功能验收另覆盖完整上游玩法、全稳定视口、战斗上下构图、倒下回城镜头一致性、点击目标移动、碰撞停止、键盘与紧凑触控浮层、大小写敏感资源路径和本地存档。
