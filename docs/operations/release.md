# 一次性发布手册

## 1. 硬前提

在执行任何外部写入前，由负责人逐项记录证据：

- 外部写入目标已核对为真实开发 Supabase `final-tma-real-test`（`ebewtjerusxcioegpzjd`）与 Vercel `final-tma`，未来生产 Supabase 在上线前保持空库且无须保留业务数据。
- 当前真实开发环境与未来生产环境使用同一组 210 张正式藏品母版生成的 420 张运行时图片；私有母版对象、公开缩略图/详情图、模板、对象键与 SHA-256 必须和当前 `generated/assets/art-assets-v2.json` 一一对应，历史 v1 对应 `generated/assets/releases/catalog-v1-initial.json`。
- 正式生产环境 `APP_ENV=production` 部署前必须提供正式 Telegram 分享图；该图片仍为已知开发占位 checksum 时禁止生产发布。休眠的 TON Connect 图标不阻塞当前 MVP。
- 本次真实开发部署的 Supabase、Vercel、Telegram、Stars 与观测平台配置齐全；当前 MVP 不配置 TON RPC 或链上资源。
- 生产将部署已在真实开发环境完成验收的同一 Git commit、同一 migration 序列和同一目录 manifest。
- Git commit、按文件名排序的三份 migration 及 SHA-256、OpenAPI、Catalog 产品 manifest、宠物资源 manifest 与 `battle-v1` checksum 已冻结；代码发布单元与可独立切换的完整宠物资源批次分别保持内部原子性。
- Vercel 套餐支持 `vercel.json` 中支付对账、幂等清理、不变量监控和宠物公开对象清理四项当前 Cron；当前 MVP 不调度 Mint 对账 Cron。
- Vercel Production 环境变量名称核查同时包含 `TELEGRAM_BOT_USERNAME` 与 `TELEGRAM_MINI_APP_SHORT_NAME`，开发 short name 固定为 `pokepets_dev`。
- Battle 发布环境已经配置互不共用且至少 32 字节的 `BATTLE_INVITE_SECRET`、`BATTLE_OUTBOX_SECRET`，并配置环境隔离的 `ABLY_API_KEY`；Supabase Vault 的两个 Battle callback URL 与 outbox secret 已和对应 Vercel 环境逐项核对。
- Battle 发布检查必须分别验证：`BATTLE_INVITE_SECRET` 只产生确定性邀请 token、`BATTLE_OUTBOX_SECRET` 只通过两个 integration 的 Bearer 鉴权、`ABLY_API_KEY` 只签发五分钟 subscribe-only capability 并发布失效通知；部署产物固定使用 `ably@2.26.0`。
- 根路径与全部前端深链必须返回 [ADR-054](../architecture/adr/ADR-054-ably-browser-csp-endpoint-allowlist.md) 的精确 Ably CSP；不得用通配协议、任意来源、固定旧 endpoint、关闭 SDK 回退/联网检测或 Function 代理代替。
- Supabase 已安装 `pg_cron`、`pg_net`、Vault 和 `pgcrypto`，套餐与项目配置支持 `battle-tick-v1` 每秒执行；Ably 套餐固定为 Standard。
- 真实开发 Bot 固定为 `@FinalTMA_bot`；Main Mini App URL 固定为 `https://final-tma-pi.vercel.app/`；named Mini App 固定为 `https://t.me/FinalTMA_bot/pokepets_dev`；默认菜单按钮固定为 `Open PokePets` 并指向该 named Mini App 链接。

任何一项与目标环境对应的前提不成立：停止发布，不恢复旧 migration、未获批准的占位素材、mock、默认业务值或功能开关。

## 2. 本地静态门禁

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:openapi
pnpm contracts:check
pnpm product-data:check
pnpm catalog:pin-assets
pnpm assets:check:catalog
APP_ENV=development pnpm build
pnpm db:migrations:check
pnpm db:lint
pnpm db:diff:check
pnpm architecture:check
pnpm assets:check:development
pnpm manifest:check
```

`pnpm typecheck` 继续检查休眠的 `@pokepets/ton` 源码，防止保留代码腐化；当前 MVP 不执行独立 `pnpm chain:build`，也不把链上部署或 TON 资源作为发布门禁。

`pnpm assets:check:catalog` 强制核对资源 manifest 的 210 个 `template_id`、210 个私有母版对象、420 个公开运行时对象、对象键、WebP 格式、尺寸、单文件体积、50 MiB 当前批次总上限、内容唯一性和 SHA-256，并确认 Git/Vercel 不含这些二进制。`APP_ENV=development pnpm build` 在生成 `apps/web/dist` 后继续确认只复制非宠物美术和统一宠物剪影；`APP_ENV=test` 与 `APP_ENV=production` 额外拒绝 Telegram 分享图的已知开发 checksum，休眠的 TON Connect 图标不属于当前 MVP 正式素材门禁。

`pnpm architecture:check` 同时验证 `/game` 只承载 React + TypeScript Battle、没有 Phaser 或客户端战斗模拟器，任务页转盘位置、远征/钱包/Mint 任务与横幅隐藏、钱包/Mint/Mint 对账不进入当前运行时注册表，活动 Web 只使用 `app-client`、目录调用方只能使用 `useCatalogQuery()`、共享 UI barrel 与 React Router 保持删除、原生导航保留单一 popstate 订阅和完整 push/replace/历史返回/同源边界、`global.css` 不得恢复、入口没有未登记的预渲染动态预取、重型操作运行时与操作表现保持动态边界、两个恢复 effect 通过 `useEffectEvent` 调用最新 `hydrate` 且不把它作为重新执行条件、操作注册中心 Context 只发布稳定 Store、聚合式 Hook 与完整 Runtime value bridge 保持删除、领域/导航/恢复/Wheel 只使用各自选择性订阅、根路径与深链唯一 CSP 的 `img-src` 不扩张且 `connect-src` 精确等于 ADR-054 的 Ably TLS 端点集合，以及其余模块边界、网关隔离和文档归属。生产 build 必须输出并通过 ADR-040/046 的 JS `400000 / gzip 125000`、CSS `110000 / gzip 23000` 首屏闭包硬门禁，以及 ADR-047/048 的 Battle 增量核心 JS `160000 / gzip 45000`、CSS `45000 / gzip 9000` 硬门禁；两组禁止模块和 Battle 动态 preload 映射中的应用入口 JS 均为零，且没有 Vite 大 chunk 警告。`pnpm contracts:check` 额外验证 OpenAPI 不发布休眠端点，并验证 `catalog.release` 与 Mint metadata 的 `x-cache-policy = public-immutable`。

休眠实现的 TON Connect manifest 仅通过以下命令保持格式确定：

```sh
pnpm manifest:build
```

该静态文件不被当前 Web 引用，不需要钱包或链上配置，也不构成 MVP 入口与生产验收项。

宠物美术固定按以下顺序独立发布：准备恰好 210 张以模板 ID 命名的 768×768 WebP 候选母版；执行 `pnpm assets:release prepare --source-dir <候选目录> --runtime-dir <受控输出目录> --release-key <唯一发布键>`；复核生成的 `generated/assets/art-assets-v2.json`；在持有目标环境服务端密钥的受控终端执行 `pnpm assets:release bootstrap --source-dir <候选目录> --runtime-dir <受控输出目录>`。`SUPABASE_SERVICE_ROLE_KEY` 可以承载 legacy `service_role` JWT 或新式 Supabase secret key；工具始终发送 `apikey`，只对三段 JWT 同时发送 Bearer，禁止把新式 secret key 作为 Bearer token。命令只进行无覆盖上传，再取得发布、回滚和清理共用的耐久租约，逐对象远端下载复核 210 个私有母版、420 个公开对象、SHA-256、尺寸、体积、MIME 与 `public, max-age=31536000, immutable` 响应后，才以同一 run ID 和 fence 原子切换数据库当前批次并读取复核。`publish`、`bootstrap` 和 `rollback` 均执行同一受控链路，不存在直接 RPC 绕过。`pnpm assets:release status` 是失效即失败门禁：当前 v2、历史 v1、产品指针、revision、两份 manifest 的全部对象登记、两个 release 的 70/210/3/5 以及每个 release 的 420 条公开 URL 全部一致后才输出 `status: "ready"`，任一 RPC 空值或漂移均以非零退出；owner SQL 还必须单独确认 `catalog.asset_mutation_runs` 没有 `running`。该流程不修改前端代码、不等待 Vercel 部署，也不 purge 目录或图片缓存；新 release key 自动形成新目录路径，回滚到旧 release key 直接复用旧路径。已打开页面不主动刷新，任一步失败都保持原批次。production 门禁继续拒绝 `generated/assets/placeholders.json` 中 Telegram 分享图的已知开发 checksum，禁止通过重新 pin 绕过正式替换要求。

既有 v1 对象只执行一次命名空间迁移：先用 `manifest-runtime-v2 --from-manifest generated/assets/releases/catalog-v1-initial.json --release-key <唯一发布键>` 生成确定的 v2 清单，再在目标环境执行同参数的 `migrate-runtime-v2`，从公开 v1 对象读取并校验内容后无覆盖上传 v2 对象，不读取或导出私有母版。数据库从空库重建时先用历史清单执行受控 v1 发布，再用当前清单执行受控 v2 发布；v1 随即成为退役批次并从该时刻计算 90 天保留期。

## 3. 真实开发环境

用户明确宣布正式生产上线前，真实开发环境不保留迁移历史。开发阶段的 Vercel Production 固定保持启用与可访问，`main` 的每次完整提交只通过 Git Integration 自动部署；不得暂停项目、等待 `503 DEPLOYMENT_PAUSED`、创建无文件变更的触发提交、在部署后重新暂停或执行手动 Vercel 部署。每次数据库定义调整都执行以下固定顺序；应用与数据库双向不兼容时不采用滚动发布，也不得在应用与数据库尚未对齐时开始验收：

1. 记录发布单元的 Git commit、OpenAPI、Catalog manifest、`battle-v1` checksum、三条 migration 文件名及 SHA-256，核对目标 Supabase 为 `final-tma-real-test / ebewtjerusxcioegpzjd`、目标 Vercel Project 为 `final-tma`，并确认工作目录位于 `main`。
2. 完成本地静态门禁；关闭开发 Bot 的 Main/named Mini App 入口和 Battle 新建/接受入口，但保持当前应用、`battle-tick-v1`、pg_net、两个 integrations 与 Ably 运行，直到 waiting、lobby、active room、active participant、locked stake、active reservation、未发布 outbox、`pending/unknown` Battle operation 和开放 Battle violation 全部为 0。
3. 再次执行第 2 步的零状态查询；该复核失败时不得继续。关闭 Telegram webhook，暂停四项 Vercel Cron；对 `battle-tick-v1` 执行 `cron.unschedule`，再在独立语句执行 `pg_reload_conf()`，保存原 `jobid` 连续两个调度周期没有新增 run 的证据。Vercel Production 在整个过程中保持启用，不把项目暂停作为业务隔离或失败恢复手段。
4. 把包含完整发布单元的单一实现提交推送到 `main`，只等待 Git Integration 自动创建的 Production deployment 达到 `READY`，并核对 source SHA 与该实现提交完全一致。数据库仍保持旧 schema 时，Telegram 入口、webhook、四项 Vercel Cron 与 `battle-tick-v1` 必须继续关闭；稳定域名在短暂切换期间可能出现应用与数据库契约不匹配，该状态只属于尚未验收的开发切换过程，不得用于功能验证或记为 PASS。不得创建空的发布触发提交，也不得执行手动 Vercel 部署。第 1 步冻结的 OpenAPI、Catalog manifest、`battle-v1` checksum 与 migration SHA-256 必须来自该实现提交。
5. 清空真实开发数据库与 migration history，从第 4 步 deployment 对应提交依次执行仓库内唯一的 `*_baseline.sql`、`*_product_data_v1.sql`、`*_api_security.sql`；三条 migration 的提交事务全部结束后，owner 必须在独立语句执行一次 `select pg_reload_conf()`，不得把该调用放入 migration 事务。
6. 验证远端 migration history 只包含第 1 步冻结的三条文件及 SHA-256，RPC、入口交接门禁、RLS、函数权限、Catalog manifest、OpenAPI 与 `battle-v1` checksum 均来自同一 Git commit；对开发项目执行 linked database lint 与 Supabase security/performance advisors。数据库从空重建不会恢复资源对象注册和当前批次，即使同一 Storage 桶仍保留全部对象，也必须在继续后续步骤前先执行 `pnpm assets:release publish --manifest generated/assets/releases/catalog-v1-initial.json`，核对 v1 active/revision=1，再执行 `pnpm assets:release publish --manifest generated/assets/art-assets-v2.json`，核对 v1 retired、v2 active/revision=2；此恢复禁止使用 `bootstrap`、重新上传或手工写表。随后执行 `pnpm assets:release status`，只接受 `status: "ready"`，并以 owner SQL 确认 1050 个 active 登记对象、两批各 210 个映射且 `catalog.asset_mutation_runs` 无 `running`。再验证 `api.catalog_current()` 与 active release 完全一致，当前和退役批次的 `api.catalog_release(checksum, release_key)` 均精确返回 70/210/3/5；保存真实 `EXPLAIN (ANALYZE, BUFFERS)`，并证明 `PUBLIC`、`anon`、`authenticated` 均不能执行两个 RPC。
7. 在 Supabase Data API 设置中把 Exposed schemas 固定为 `public,graphql_public,api`，不得暴露任何业务表 schema；核对 Vercel Production 的 Telegram、Ably 与 Battle 环境变量以及 Supabase Vault 的 Battle share/outbox callback URL 和 outbox secret。环境变量不得设置为 Sensitive，环境值变化后仍只通过包含全部修改的 `main` 提交触发自动部署，并重新核对 source SHA。
8. 确认 `admin.database_identity` 与 `admin.environment_controls` 在迁移后均为空，所有应用角色均不能发现或执行 `admin`；由数据库 owner 把项目身份一次性绑定为 `real_development / ebewtjerusxcioegpzjd`，再写入同值、最长 24 小时的 Battle 验收夹具 enable。该记录是非秘密数据库元数据，不使用 Vercel/Supabase Sensitive 环境变量或 Vault。
9. 保持 Telegram 入口、webhook 与 Vercel Cron 关闭，确认 `battle.tick_health()` 的唯一 job、`1 second`、`select battle.process_due(100);`、当前 database、`postgres` worker、单一 scheduler 和最近 5 秒成功记录全部正确，并保存同一 jobid 至少两个连续自然周期的 runid、起止时间、状态和返回摘要；手工调用 tick 不得替代该证据。
10. 所有受控验收账号关闭切换前加载的旧 Mini App；ADR-038 令牌切换不接受旧格式或双密钥兼容。继续关闭 Telegram 入口、webhook 和四项 Vercel Cron；确认稳定域名指向第 4 步 deployment，且应用、数据库、OpenAPI、Catalog manifest、`battle-v1` checksum 与 migration SHA-256 已全部对齐后，执行 `/api/health`、真实登录、身份 RPC 次数与篡改令牌验证、Battle 2/3/4 技能响应、两个 pg_net callback、Ably subscribe-only token 和 `RESPONSE_INVALID = 0` 的受控验证。生产根路径与 `/game` 必须返回 ADR-054 的 CSP；真实 iPhone Telegram WebView 通过 Safari Web Inspector 证明 realtime token 成功、`main.realtime.ably.net` WebSocket 已连接、联网检测和回退域无 CSP 拒绝、真实邀请接受按 ADR-056 从 invite 授权切换到同身份 room 授权、自动刷新后仍保持当前最小订阅、真实失效通知只触发一次 REST 权威读取，且 Console 无 token 更新、连接或频道订阅失败诊断；连接稳定且 deadline 未到时没有固定 1—2 秒轮询。临时阻断 Ably 请求时既有 REST 回正必须接管，解除阻断并重连后固定短轮询停止。`/api/catalog` 必须始终 `no-store` 且 request ID 每次不同；release 路径在不携带 `Pragma: no-cache` 的同区域请求中必须先 `MISS` 后 `HIT`，raw JSON 小于 10 MB，成功响应没有项目级 `x-request-id`、认证、Cookie 或 `Vary: *`，错误响应保持 `no-store`。完成入口交接的正常登录必须依次且只执行来源限流、登录事务与 `identity_initial` 三个 RPC，并由同一个浏览器认证请求取得首屏权威状态；推荐绑定仍为 `pending` 时登录只执行前两个 RPC，绑定形成确定终态后再单独执行一次 `identity_initial`。简单玩家请求必须只有自身业务 RPC，运行中不得调用 `identity_resolve_session`，人工刷新、前台恢复、业务资产变化、Battle 终局和页面返回均不得调用 `identity_initial`。旧 WebView 不得重新认证或继续调用新数据库，账号必须从 Telegram 重新打开并加载当前 deployment 后才进入验收。
11. 调用 Bot API 核对开发 Bot 身份后，依次恢复 Telegram webhook、四项 Vercel Cron、Main/named Mini App 与默认菜单入口；验证 `battle-v1` checksum、`battle-tick-v1` 自然运行、监控链路、7 天运行明细、`/api/referrals` 与四个手工 Vercel job。Battle tick 历史失败必须保留原行、错误哈希与首次/最近失败证据，并由自然 `monitor-invariants` 在当前 job 稳定健康后自动写入关闭时间和恢复证据；禁止人工关闭或删除。最后按 `docs/operations/acceptance.md` 完成 Telegram iOS/Android 的首次目录、刷新、开盒代表图、藏品深链、进化、市场名称、资源 A→B→A、Battle、支付与并发验收；目录网络瀑布必须是一个动态小 pointer 加一个浏览器/CDN 可复用 release，且浏览器不访问 Supabase Data API。`monitor-invariants` 必须返回 0 个新增 violation，开放 Battle violation 必须为 0。

任一步失败都保持 Telegram 入口、webhook 与 Vercel Cron 关闭，但 Vercel Production 继续启用，不通过暂停项目恢复。数据库清空前不得把“新应用 + 旧数据库”记为可验收状态；数据库清空后直接修正声明式 Schema、原始三条 migration 与完整发布单元，提交并推送新的完整 `main` 提交，再从空库重新执行第 5—11 步。禁止单独回滚应用、恢复旧 schema、创建空触发提交或为尚未生产发布的错误定义追加修补 migration。

当前 MVP 在真实开发和生产均不发布 TON Collection、不配置 TON runtime secrets、不调度 `reconcile-mints`，也不执行钱包与 Mint 验收。钱包、Mint、合约、API 契约和数据库定义仅保留休眠。

## 4. 生产切换

顺序不可调整：

1. `APP_ENV=production pnpm build` 与 `pnpm assets:check:production` 均成功。
2. 再次证明生产 migration history 为空且无须迁移数据。
3. 按 `find supabase/migrations -maxdepth 1 -name '*.sql' | sort` 输出的唯一三条迁移应用，后缀依次必须是 `_baseline.sql`、`_product_data_v1.sql`、`_api_security.sql`。
4. 确认生产库 `admin.database_identity` 与 `admin.environment_controls` 保持空；即使随后绑定 `production` 身份，也禁止启用 Battle 验收夹具。
5. 部署与真实开发环境验收通过的完全相同 Git commit；不配置 TON runtime secrets，不发布 Collection。
6. 设置 Telegram webhook；启用生产 Bot 的 Main Mini App，将 Main Mini App 与 named Mini App 固定到该次部署的唯一生产域名，默认菜单按钮固定指向 named Mini App 链接，并用 Bot API 验证 `has_main_web_app=true` 与菜单 URL 完全一致。
7. 对生产域名确认 `/game` 完整提供 Battle、远征界面仍隐藏、钱包与 Mint 入口均不存在、Ably capability 为 subscribe-only；按 ADR-054 通过 Safari Web Inspector 验证主 WebSocket、联网检测、回退域、真实失效通知、稳定连接停止固定短轮询和阻断后的 REST fallback，再确认 `battle-tick-v1` 正常及任务页转盘位置。
8. 执行生产 smoke check、四个 Vercel job、Battle tick 和两个 Battle integrations；保存 request/operation/room/state_version/stake/settlement/outbox/ledger/inventory 证据。

## 5. 回滚边界

不回滚数据库到旧 schema，不重新开放旧 API。正式生产上线前，部署失败时保持 Telegram 业务入口与调度关闭但不暂停 Vercel Project，修正原始三条迁移并从空真实开发数据库重建；正式生产上线后才使用只追加的前向修复。已经 Mint 的 NFT、已确认 Stars 支付和已锁定或结算的 Battle 只能通过原 operation、数据库 tick 与恢复流程完成，不能重复交付、改判、退款或撤销既有事实。
