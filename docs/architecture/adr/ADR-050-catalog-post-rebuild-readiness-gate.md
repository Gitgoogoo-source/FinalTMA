# ADR-050：Catalog 空库重建后的发布恢复与失效即失败门禁

- 状态：Accepted
- 日期：2026-08-09

## 背景

Supabase 从空数据库执行 migration 只恢复 Catalog v1 产品数据和资源发布结构，不会根据 Storage 中仍然存在的对象自动重建 `asset_delivery_config`、`asset_objects`、`asset_releases`、模板映射或当前指针。此时 Storage 可以继续保有全部 WebP，数据库却没有 active release，`api.catalog_current()` 会抛出 `CATALOG_UNAVAILABLE`，同源 `GET /api/catalog` 因而返回 503。

旧的 `pnpm assets:release status` 只打印 `api.catalog_asset_current()`。当 RPC 返回空值、历史 v1 未登记、当前指针与资源发布不一致或完整目录缺项时，命令仍可能以退出码 0 结束，不能作为数据库重建后的放行门禁。

## 决策

数据库从空重建后的资源恢复顺序固定为 v1→v2：先对 `generated/assets/releases/catalog-v1-initial.json` 执行 `publish`，确认 v1 active 且 revision=1；再对 `generated/assets/art-assets-v2.json` 执行 `publish`，确认 v1 retired、v2 active 且 revision=2。恢复只复用并逐对象校验 Storage 中已有的 630 个对象，不使用 `bootstrap`、不重新上传、不手工插入资源登记，也不修改数据库 schema、migration 或 Catalog HTTP 契约。

`pnpm assets:release status` 固定读取当前 v2 manifest，并执行失效即失败校验：

1. `api.catalog_asset_current()` 必须与当前 manifest 的 release key、manifest SHA-256、210 个模板、正整数 revision、目标公开 origin 和 `pet-runtime` 桶一致。
2. `api.catalog_asset_release_get()` 返回的当前 v2 与历史 v1 登记必须逐模板匹配各自 Git manifest 的母版、缩略图和详情图对象元数据；v1 与当前 release key 必须不同。
3. `api.catalog_current()` 的 v1 产品 checksum、release key 和 `asset_revision` 必须与当前资源指针一致。
4. 当前 v2 与历史 v1 都必须能由 `api.catalog_release(checksum, release_key)` 读取，精确返回 70/210/3/5；210 个模板的两种公开 URL 必须逐项指向各自 manifest 的内容哈希对象。
5. 全部校验完成后才输出 `status: "ready"`；空值、RPC 错误、任意数量、身份、登记或 URL 漂移都以非零退出码结束。

现有 service-role RPC 没有暴露内部租约表，状态命令不得为了读取租约而创建再中止一条变更记录。发布验收在 owner SQL 边界额外要求 `catalog.asset_mutation_runs` 的 `running` 数量为 0；这是只读云端门禁，与状态命令共同组成完整放行条件。

## 发布与验证

`publish` 继续使用 ADR-031 的耐久租约、fence、远端 SHA-256/MIME/尺寸/缓存策略校验和原子指针切换；本裁决不复制或改变资源生命周期与不可变缓存语义。新式 Supabase secret key 只发送 `apikey`，legacy `service_role` JWT 同时发送 `apikey` 与 Bearer。

架构门禁必须锁定 ADR、本地两份 manifest、`status` 对三个读取 RPC 的调用、历史发布校验和 `ready` 输出，避免退化为只打印当前资源摘要。数据库验收必须证明 1050 个 active 登记对象、v1 retired、v2 active、每批 210 个映射、revision=2、无 running 变更租约，并执行两个目录 RPC 的权限、错误与真实执行计划验证。Vercel 和真实 Telegram 验收继续按 ADR-042 检查 pointer/release 缓存、503/`RESPONSE_INVALID` 日志、公开图片和浏览器无 Supabase Data API；静态、数据库、HTTP 与真机证据不得互相替代。
