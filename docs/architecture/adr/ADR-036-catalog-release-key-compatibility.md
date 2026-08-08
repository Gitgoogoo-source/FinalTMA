# ADR-036：宠物资源受控发布的服务端密钥兼容与重建门禁

## 状态

已接受。

## 决定

宠物资源发布工具继续只通过 `SUPABASE_SERVICE_ROLE_KEY` 接收目标环境的服务端密钥。该变量允许承载 legacy `service_role` JWT 或 Supabase 新式 `sb_secret_` 密钥；工具始终发送 `apikey`，仅当密钥具有三段 JWT 结构时才同时发送 `Authorization: Bearer`。新式 secret key 禁止作为 Bearer token 发送。工具不得输出、写入清单或持久化密钥。

密钥格式兼容不改变受控发布链：`publish`、`bootstrap` 与 `rollback` 仍必须取得耐久资源变更租约，逐一下载并验证 210 个私有母版和 420 个公开运行时对象的 SHA-256、MIME、尺寸与公开缓存策略，再调用同一 run ID 和 fence 保护的 RPC 原子切换当前批次，并读取当前批次复核。禁止为绕过鉴权或工具失败而直接执行发布 RPC 或直接写资源表。

数据库从空重建会清除 `catalog.asset_delivery_config`、资源对象注册、发布批次和当前批次指针；Supabase Storage 中仍存在对象不能替代这些数据库事实。迁移完成后、恢复 Telegram 与 Vercel 用户流量前，必须使用冻结提交中的当前资源 manifest 重新执行受控 `publish`，并确认 release key、manifest SHA-256、revision、210 个模板以及 210 组缩略图和详情图 URL 全部有效。任一条件不成立时保持用户入口关闭，不允许开盒、市场、藏品、进化、Battle 等依赖宠物图片的业务进入可操作状态。

## 原因

Supabase 新式 secret key 不是 JWT。把它放入 Bearer 头会在请求到达发布 RPC 前被 Data API 拒绝。另一方面，Storage 对象与数据库当前批次是两个独立事实面；只检查桶内文件会把“文件存在但 API 无法生成 URL”的环境误判为可用。固定密钥头规则和重建后的当前批次门禁，才能在不削弱对象校验、租约、幂等发布与原子切换的前提下恢复完整目录 URL。

## 验证

影响域验证必须分别覆盖 legacy `service_role` JWT 和新式 secret key 的 `pnpm assets:release status`，确认两者都只访问目标项目且不输出密钥。真实环境发布还必须执行完整 630 对象远端校验、读取当前批次、核对 210/210 URL，并在 Telegram Mini App 中验证开盒结果和依赖宠物图片的普通用户页面。静态检查或桶内对象计数不能替代真实发布与 TMA 验收。
