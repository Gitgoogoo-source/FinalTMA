# ADR-011：Monster Tamer 认证藏品家园与受控 Phaser 渲染边界

## 状态

已接受，替代原“公开独立探索游戏与三层海岛”裁决。

## 背景

Monster Tamer 的唯一产品目标已经改为展示玩家在 FinalTMA 中真实可用的藏品。原公开静态游戏拥有自己的玩家、怪物、NPC、道具、遭遇、战斗、捕捉、队伍、背包和页面内存状态，这些内容与藏品家园目标冲突，必须删除。

家园需要同时满足两条边界：真实藏品仍只能由已登录 React 主应用通过认证接口读取；Phaser 只负责高频地图渲染、漫游和点击，不能持有会话或请求业务 API。

## 决策

1. 游戏页顺序保持 `MonsterTamerPanel → ExpeditionPanel → WheelPanel`。Monster Tamer 启动卡改为 React 按钮，通过 Portal 在 `document.body` 打开全屏家园，不再离开主应用。
2. React 领域组件只调用现有 `inventory.list` 查询，固定过滤 `available > 0` 并按 `template_id` 去重。同一模板无论数量多少，一种只显示一只；没有展示总数上限，也不提供用户选择名单。
3. `apps/web/public/monster-tamer` 保留为同源、受控 Phaser 渲染文档。`/monster-tamer/` 直接访问时不请求 API、不读取 Catalog 列表，只显示“请从 FinalTMA 游戏中心进入”。
4. React 父页面通过同源 `postMessage` 向 `iframe` 注入最小只读字段：`templateId`、名称和 `imageThumbnailPath`。双方同时校验 `origin` 与消息窗口；不传 access token、session generation、Telegram `initData` 或用户标识。
5. 地图固定为 `50×50`、每格 `64px` 的 `main_1`。最外两格连续水域；中央只有一块不规则、连续、漂浮在 `#47ABA9` 水面上的草地岛。
6. 地图只保留 `Water-Scenery`、`Flat-Ground`、`Scenery` 和 `Collision`。水域、岸边、Blue Buildings、树木、树桩和岩石占地不可通行，其余至少 210 个陆地格全部连通。
7. 地形继续从 Tiny Swords `Tilemap_color1` 生成复制边缘图集；场景只使用 Blue Buildings、树木、树桩、灌木、陆地岩石、水中岩石、水泡沫和阴影。来源、32 文件清单、SHA-256 与条款快照继续随部署保存。
8. 宠物只使用正式 `/assets/catalog/v1/thumb/` 路径。每个实体逐格选择相邻可通行格，使用占用格与预定格集合避免进入障碍或与其他宠物重叠。
9. 宠物主体世界尺寸固定为 `56×56` 像素，在固定 `0.5` 倍镜头下显示为原宠物尺寸的 `50%`；阴影、点击区域、上下浮动和压缩伸展位移使用同一尺寸基准同步缩小 `50%`。静态缩略图通过水平翻转、上下浮动、压缩伸展和 Tiny Swords 阴影形成活动效果，不生成第二套方向、战斗或养成素材。
10. 恢复原开放 RPG 的 AxulArt 默认玩家精灵及四方向三帧行走动画。人物只用于浏览家园，不形成角色资产、属性、队伍或持久化进度。
11. 镜头固定 `0.5` 倍并平滑跟随人物，地图、人物与宠物以原 `1` 倍镜头的 `50%` 尺寸显示，横向和纵向可视范围各扩大到原来的 `2` 倍。唯一移动输入是手机触摸点按可通行地面；独立四方向寻路避开静态障碍与宠物占用/预定格。运行时不注册地图拖动、滚轮或双指缩放、键盘、WASD、方向键、鼠标点地、摇杆、A/B 或战斗 HUD。
12. 点击宠物时 Phaser 暂停场景，只返回 `template_id`，且不触发人物移动。React 在当前认证查询结果中重新匹配后，通过现有藏品详情组件在游戏上方展示正式详情；关闭详情向 Phaser 发送恢复消息，镜头、人物和宠物位置不重建。
13. 家园只读，不新增 API、RPC、数据库对象、migration、操作、账本、浏览器持久化或恢复工作流。关闭整个家园后销毁 `iframe` 与 Phaser 页面内存状态。
14. 原玩家控制器、NPC、告示牌、探索与战斗、遭遇、捕捉、队伍、背包、道具、菜单、过场、音频、旧 JSON、相关图片、Web Font Loader 和 Tweakpane 从运行树删除；只恢复原默认玩家精灵和许可证，本次触摸寻路重新编写。
15. `/monster-tamer` 与 `/monster-tamer/` 的 Vercel 重写继续位于 SPA catch-all 之前，只为同源 `iframe` 提供渲染文档，不构成业务入口。

## 可信边界

数据库与 `inventory.list` 是藏品事实来源。React 只把服务端已确认的显示字段传给 Phaser；Phaser 返回的点击消息只作为用户意图，React 必须用 `template_id` 在当前查询结果中重新解析。

静态渲染器不得使用 `fetch`、XMLHttpRequest、WebSocket、Supabase 或业务命令，并且不使用浏览器持久化。正式 Catalog 图片是同源静态资源，不把图片加载等同于藏品归属验证。

## 结果

Monster Tamer 不再形成第二套怪物玩法，只把玩家真实可用藏品呈现在可活动的水上家园中。React DOM 保留认证、错误状态、无藏品状态与现有藏品详情；Phaser 保留地图、默认人物、触摸寻路、跟随镜头、宠物移动和点击所需的最小渲染职责。

真实 Telegram iOS 与 Android 验收必须覆盖安全区、全屏关闭、触摸寻路、镜头跟随、宠物点击、详情暂停/恢复和无可用藏品空岛；Desktop 与 Web 必须确认键盘、WASD、方向键和鼠标点地不能移动人物。静态构建与架构检查不能替代这些真实环境验收。
