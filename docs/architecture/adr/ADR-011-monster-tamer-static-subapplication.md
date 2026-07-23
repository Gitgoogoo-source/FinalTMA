# ADR-011：Monster Tamer 独立静态子应用与无缝田园地图

## 状态

已接受。

## 背景

产品第 21 章要求 Monster Tamer 继续作为 FinalTMA 游戏页中的独立本地游戏，同时把缺乏可玩性的多张旧地图重做为一张可连续探索的大地图。本次变更只涉及地图、美术、主角移动、动画、碰撞和相机，不新增采集、NPC、怪物、剧情、室内或其他玩法。

把游戏源码导入 React bundle、复用 FinalTMA session 或接入业务 API 会扩大可信边界。继续使用多地图入口会违背单一无缝世界要求；把 480×240 全图烘焙为单张背景大图会形成不必要的内存和加载压力，因此世界视觉必须由可裁剪的运行时 tile layer 构成。

## 决策

Monster Tamer 固定采用以下架构：

1. 完整运行树位于 `apps/web/public/monster-tamer`，入口固定为 `/monster-tamer/`；`/monster-tamer` 与 `/monster-tamer/` 在 SPA catch-all 前重写到独立 `index.html`。
2. `apps/web/src/domains/monster-tamer` 只渲染启动卡片并使用普通链接。游戏页顺序固定为 `MonsterTamerPanel → ExpeditionPanel → WheelPanel`。
3. 静态子应用不导入 React 应用、API 契约或业务领域，不读取 FinalTMA session、Telegram `initData`、Catalog、业务资产或数据库，不发起业务网络请求。
4. Phaser 保持本地 `3.60.0`；Web Font Loader `1.6.28` 与 Tweakpane `4.0.3` 也从本地 `vendor` 目录加载，不执行引擎升级。
5. 运行时世界只保留 `main_1`。地图固定为 480×240 个 64px 图块，世界尺寸为 30,720×15,360；旧 `forest_1`、`building_1`、`building_2`、`building_3`、`level`、`level_old` 和所有旧 background/foreground 地图大图删除。
6. 唯一地图同时承载中央村庄与农田、森林、湖泊、河流、山地、海岸、道路和桥梁。建筑只作为不可进入的装饰，不创建 `Scene-Transitions`。
7. 可见地图固定使用 `Ground`、`Terrain`、`Structures`、`Foreground` tile layer，静态阻挡固定使用 `Collision` layer。地图继续承载原有 10 个 NPC、6 个 Item、9 个 Sign 与 `area=1/2/3` 三个 Encounter 区域，不增加玩法对象。
8. 地图美术固定使用 Kenney Tiny Town `1.1`、Tiny Farm `1.0`、Tiny Battle `1.0` 三套 CC0 图块。Tiny Battle 只使用水体、岸线、草地和自然地表；三套资源的许可证、来源和 SHA-256 随静态树发布，运行时不访问第三方。
9. 主角继续使用 `assets/images/axulart/character/custom.png`。世界移动继续采用 64px 逐格模型，步行固定 400ms/格，跑步固定 220ms/格；普通步行横穿 480 格约 192 秒。
10. 桌面移动同时支持 WASD 与方向键，移动端使用左下虚拟摇杆，Shift 与 B 分别控制跑步。双轴输入每格先尝试主方向，主方向受阻时尝试次方向，实现沿障碍贴边滑动而不穿透。
11. 主角只有发生实际位移时播放当前方向动画；每格结束或受阻时停止并保持正确朝向站立帧。相机使用非零 lerp 平滑跟随，并限制在整个 `main_1` 世界边界。
12. Telegram SDK 只处理 ready、expand、原生 fullscreen、稳定视口、安全区、垂直滑动保护和 BackButton；虚拟摇杆、A、B 与世界菜单位于设备安全区和内容安全区内。失焦、页面隐藏、Telegram 停用和 pointer cancel 均释放全部输入。
13. 唯一持久化键继续为 `MONSTER_TAMER_DATA`。缺少当前世界版本的旧存档只把旧地图名、坐标和方向迁移到新 `main_1` 安全出生点；设置、怪物队伍、背包、拾取状态、已击败 NPC 和其他玩法进度全部保留。迁移完成后立即写回同一个键，避免每次刷新重复迁移。
14. 上游 MIT 许可证、运行库许可证、Kenney CC0 许可证、第三方 notices 和原创资源来源记录随静态树发布。发布门禁验证版本、SHA-256、文件路径、地图契约和第三方网络请求为零。

## 边界

Monster Tamer 不拥有 API route、OpenAPI schema、Function、环境变量、Supabase schema、RPC、migration、operation、ledger、reservation 或 recovery workflow。FinalTMA 不读取本地游戏存档，也不把游戏内怪物、道具、战斗、捕捉或经验映射为藏品、Fgems、K-coin、任务或奖励。

Catalog v1 product-data checksum boundary 位于产品第 21 章之前。第 21 章不改变 Catalog v1 immutable release identity，不生成或修改目录 manifest 与 product-data migration。

## 结果

单一 tilemap 避免巨型全图纹理并允许 Phaser 按相机裁剪渲染；保存格式继续保持独立，旧玩家只迁移世界位置而不丢失玩法进度。发布门禁必须验证静态边界、唯一路由、唯一地图、图层和对象契约、旧地图删除、输入契约、Kenney 授权证据、本地运行库与本地存档。真实功能验收必须覆盖完整地图可达性、3 分 12 秒横穿时间、桌面和移动输入、动画停止帧、碰撞贴边滑动、相机平滑跟随以及原有玩法回归。
