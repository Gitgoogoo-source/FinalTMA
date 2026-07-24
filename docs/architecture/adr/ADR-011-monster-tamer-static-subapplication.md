# ADR-011：Monster Tamer 独立静态子应用与 Tiny Swords 三层海岛

## 状态

已接受。

## 背景

产品第 21 章要求 Monster Tamer 继续作为 FinalTMA 游戏页中的独立本地游戏，并将地图地形、地图装饰和建筑替换为 Tiny Swords 风格。本次变更允许重新设计地形与建筑布局，但不改变主角、移动、操控、动画规则、相机、玩法对象或玩法规则，不增加人物、动物、资源采集、室内或其他玩法。

把游戏源码导入 React bundle、复用 FinalTMA session 或接入业务 API 会扩大可信边界。完整世界仍需由 Phaser tile layer 和按底部锚点排序的 scenery object 构成，避免把 `15,360×7,680` 世界烘焙为单张巨型背景。

## 决策

Monster Tamer 固定采用以下架构：

1. 完整运行树位于 `apps/web/public/monster-tamer`，入口固定为 `/monster-tamer/`；`/monster-tamer` 与 `/monster-tamer/` 在 SPA catch-all 前重写到独立 `index.html`。
2. `apps/web/src/domains/monster-tamer` 只渲染启动卡片并使用普通链接。游戏页顺序固定为 `MonsterTamerPanel → ExpeditionPanel → WheelPanel`。
3. 静态子应用不导入 React 应用、API 契约或业务领域，不读取 FinalTMA session、Telegram `initData`、Catalog、业务资产或数据库，不发起业务网络请求。
4. Phaser 保持本地 `3.60.0`；Web Font Loader `1.6.28` 与 Tweakpane `4.0.3` 也从本地 `vendor` 目录加载，不执行引擎升级。
5. 运行时世界只保留 `main_1`。地图固定为 `240×120` 个 `64px` 图块，世界尺寸为 `15,360×7,680`，面积是被替换地图的四分之一；水体底色固定为 `#47ABA9`。旧地图 JSON、旧 background/foreground 地图大图和 Tuxemon 地图素材删除。
6. 地图构图固定为水域环绕的三层海岛：北部最高层是城堡区，中部是横向主路与森林，东部是蓝色建筑村落，南部是探索区。建筑只作为不可进入、不可交互的场景与碰撞障碍，不创建 `Scene-Transitions`。
7. 可见地图固定使用 `Water-Scenery`、`Flat-Ground`、`Shadow-Level-1`、`Elevation-Level-1`、`Shadow-Level-2`、`Elevation-Level-2` 与 `Scenery`；静态阻挡固定使用 `Collision`。树木、灌木、岩石和建筑按底部锚点进行世界深度排序。地图继续承载原有 10 个 NPC、6 个 Item、9 个 Sign 与 `area=1/2/3` 三个 Encounter 区域，不增加玩法对象。
8. 地图美术固定使用 Pixel Frog 的 `Tiny Swords (Free Pack)`。地形只使用 `Tilemap_color1` 黄绿色草地、水体、泡沫、阴影、两级高差和阶梯；建筑只使用 `Blue Buildings` 的 Castle、Tower、Barracks、Archery、Monastery、House1、House2 和 House3；装饰只使用树、树桩、灌木、陆地岩石与水中岩石。
9. Tiny Swords 白名单固定为 32 个 PNG。人物、单位、动物、羊、金矿、食物、工具、粒子特效、UI、云、橡皮鸭、Aseprite、其他阵营颜色和 Enemy Pack 均不得进入源码白名单或运行时。源路径、尺寸和 SHA-256 固定记录在 `assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/SOURCE.json`；运行时发布 `528×528` 复制边缘地形图集和白名单中的建筑、动画装饰，不访问第三方。
10. 建筑左下锚点固定为：Castle `(118,28)`；Tower `(91,30)`、`(147,30)`、`(65,98)`；Barracks `(103,36)`；Archery `(135,36)`；Monastery `(159,78)`；House1 `(165,56)`、`(195,70)`；House2 `(177,52)`、`(205,58)`；House3 `(189,62)`、`(175,72)`。
11. 玩家出生点固定为 `(118,68)`，复活点固定为 `(122,66)`。横向主路从 `(18,68)` 到 `(222,68)`；普通步行 `400ms/格`，完整横穿 `204` 格为 `81.6 秒`。主角素材、WASD、方向键、虚拟摇杆、Shift/B 跑步、64px 逐格移动、碰撞贴边滑动和相机 lerp 全部保持原规则。
12. Telegram SDK 只处理 ready、expand、原生 fullscreen、稳定视口、安全区、垂直滑动保护和 BackButton；虚拟摇杆、A、B 与世界菜单位于设备安全区和内容安全区内。失焦、页面隐藏、Telegram 停用和 pointer cancel 均释放全部输入。
13. 唯一持久化键继续为 `MONSTER_TAMER_DATA`，世界版本固定升级为 `3`。版本 `1` 或 `2` 的旧存档只把区域、坐标和方向迁移到 `(118,68)` 的新 `main_1` 安全出生点；设置、怪物队伍、背包、拾取状态、已击败 NPC 和其他玩法进度全部保留。迁移完成后立即写回同一个键。
14. 上游 MIT 许可证、运行库许可证、Tiny Swords 来源页面、Pixel Frog 署名、32 个白名单文件记录、条款快照、修改说明、第三方 notices 和原创资源来源记录随静态树发布。发布门禁验证白名单、源文件 SHA-256、运行时文件集、地图契约和第三方网络请求为零。

## 边界

Monster Tamer 不拥有 API route、OpenAPI schema、Function、环境变量、Supabase schema、RPC、migration、operation、ledger、reservation 或 recovery workflow。FinalTMA 不读取本地游戏存档，也不把游戏内怪物、道具、战斗、捕捉或经验映射为藏品、Fgems、K-coin、任务或奖励。

Catalog v1 product-data checksum boundary 位于产品第 21 章之前。第 21 章不改变 Catalog v1 immutable release identity，不生成或修改目录 manifest 与 product-data migration。

## 结果

三层 tilemap 避免巨型全图纹理，scenery object 在不改变碰撞规则的前提下正确遮挡角色。保存格式继续保持独立，旧玩家只迁移世界位置而不丢失玩法进度。发布门禁必须验证静态边界、唯一路由、唯一地图、图层和对象契约、旧地图与旧地图素材删除、输入契约、Tiny Swords 白名单与条款证据、本地运行库和本地存档。真实功能验收必须覆盖 `81.6 秒`主路横穿、两级阶梯和全部保留对象可达、桌面与移动输入、碰撞贴边滑动、相机跟随及原有玩法回归。
