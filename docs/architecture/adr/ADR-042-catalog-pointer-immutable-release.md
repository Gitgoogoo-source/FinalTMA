# ADR-042：目录当前指针与不可变发布内容分离

- 状态：Accepted
- 日期：2026-08-09

## 背景

原 `GET /api/catalog` 每次从数据库连接 70 条链、210 个模板及其 420 个运行时对象、3 个箱子和 5 个充值档位，再以 `no-store` 返回完整目录。目录主体只在 Catalog 产品版本或资源发布批次变化时改变；让每个 WebView 重复执行同一大查询和传输同一大响应，会把不可变内容错误地当成动态状态处理。

`asset_revision` 表示当前指针的发布或回滚切换次数。同一不可变发布批次在回滚后会获得新的 revision，但资源映射和完整目录内容没有改变，因此 revision 不能作为不可变缓存身份。`asset_releases.release_key` 在单环境内永久对应同一映射，同键不同内容已由发布事务拒绝，适合作为资源发布身份。

## 裁决

`GET /api/catalog` 的 route ID 固定为 `catalog.current`，只返回标准信封中的 `version`、Catalog v1 `product_checksum`、当前 `asset_revision` 和 `release_key`。该动态指针始终返回 `Cache-Control: no-store`，并为每次源站响应生成独立 `request_id`。

`GET /api/catalog/releases/v1/{product_checksum}/{release_key}` 的 route ID 固定为 `catalog.release`，是无认证、raw JSON 的不可变内容读取。成功响应精确包含版本、checksum、release key、70 条链、210 个模板、3 个箱子和 5 个充值档位，不包含 revision；固定发送 `Cache-Control: public, max-age=31536000, immutable` 与 `Vercel-CDN-Cache-Control: public, s-maxage=31536000`。成功响应不发送项目级 `x-request-id`、`Authorization`、`Set-Cookie` 或 `Vary: *`。失败响应仍为标准错误信封和 `no-store`，不得进入 CDN。

`RouteDefinition.cachePolicy = "public-immutable"` 是唯一公开不可变策略，只能声明在 `GET + auth:false + rawResponse:true` 路由；OpenAPI 输出 `x-cache-policy`。Mint metadata 使用同一声明，响应层不再按路由 ID 硬编码缓存行为。目录不使用短 TTL、ETag、缓存标签、Runtime Cache、purge 或缓存清除；新内容必须形成新的 checksum 或 release key URL，旧缓存永不原地失效。

## 数据库与回滚语义

`api.catalog_current()` 只连接 Catalog v1 checksum、当前 active release 和 revision。`api.catalog_release(product_checksum, release_key)` 只按参数选择 active 或 retired release，并连接该批次自己的 210 条模板映射和 active 运行时对象；它不得读取 `catalog.current_asset_release`。checksum 不匹配、staging/未知发布、映射不完整、运行时对象不可用，或最终 70/210/3/5 数量不完整时统一抛出 `CATALOG_UNAVAILABLE`。

两个 RPC 仅向 `service_role` 授权；浏览器仍只调用同源 API，并只直接读取 API 返回的 Supabase Storage 公开宠物图片 URL。现有 release key 唯一约束、发布模板主键、模板与对象主键覆盖读取，不新增索引；真实开发库以 `EXPLAIN (ANALYZE, BUFFERS)` 复核实际计划。

发布 A→B 后指针改为 B，A 的路径和响应保持不变。回滚 B→A 只递增指针 revision，A 继续复用原不可变 URL 与缓存。资源发布、回滚和部署均不清除目录缓存；退役批次的公开对象仍遵守 ADR-031 的回滚锁和 90 天保留边界。

## Web 数据流与失败行为

所有 Web 调用方只能使用 `useCatalogQuery()`。该入口先读取 `catalog.current`，再以指针的 checksum 与 release key 读取 `catalog.release`，最后把 pointer 的 revision 合并为内部 `CatalogSnapshot`，保持现有消费形态。架构门禁禁止领域组件直接读取两个目录路由。

指针变化期间保留上一个成功快照，直到新 release 成功；新 release 失败不得清空已渲染目录。只有全新 WebView 没有任何成功快照时才显示既有玩家错误文案。人工重试固定先刷新 pointer，再读取该 pointer 对应 release；React Query 和 API 客户端都不执行无限自动重试。

## 迁移、发布与验证

项目尚未正式生产上线，因此直接替换 `65_catalog_api.sql`、原始 baseline migration 与 API security migration 中的旧定义，不保留 `catalog.get` 或 `api.catalog_get()`，也不新增补丁 migration。契约、OpenAPI、API、Web、资源 ADR、运行架构、事务说明、产品说明、发布手册和验收清单必须同步形成一个提交。

静态门禁覆盖格式、ESLint、Web/API/Contracts TypeScript、OpenAPI 漂移、架构、schema/migration 一致性、生产构建和 ADR-040 首屏预算。真实开发数据库从空重建并恢复当前资源批次后，必须验证 pointer 一致性、70/210/3/5、A→B→A 内容稳定、无效 release 统一失败、角色权限与真实执行计划。Vercel 必须证明 pointer 永远 `no-store`，release 首次同区域 `MISS`、随后 `HIT`、成功响应不超过 10 MB 且没有请求级标识，失败不缓存，新路径不清除旧路径。Telegram iOS 与 Android 最终覆盖首次进入、刷新、开盒代表图、藏品深链、进化、市场名称和资源发布/回滚，并证明浏览器没有访问 Supabase Data API。
