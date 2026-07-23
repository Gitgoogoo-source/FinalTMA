# 故障恢复

## 会话与 API

先按 `request_id` 定位结构化日志，再按 `operation_id` 查询数据库。会话过期只允许重新交换一次；会话替换、撤销或 Telegram 入口缺失时要求用户重新进入 Mini App。

收到 `ENTRY_HANDOFF_PENDING` 时不得放开主页面。核对 `identity.sessions.referral_processed_at`、`identity.entry_candidates` 与当前 `referral.bind` 操作；只查询原邀请操作，确定成功或拒绝后由 RPC 完成交接，不得手工写会话完成时间。

## 未知操作

禁止重新生成幂等键。使用 `GET /api/operations/:operation_id` 查询原操作；数据库终态与前端临时状态不一致时刷新契约声明的资产、库存、支付或 Mint scope，以数据库结果覆盖。

封禁事故先确认客户端已切换到新 generation 且 DOM、查询缓存、操作弹窗和导航为空，再按旧 generation 定位迟到请求。禁止通过恢复缓存或重放成功响应复原页面。

## Stars

确认订单、Telegram update、charge 唯一键和账本记录。手工触发 `reconcile-payments` 只扫描数据库当前全部未决订单；不得手工写余额。重复 webhook 和重复任务必须由唯一约束及 RPC 返回同一结果。

## Mint

确认 Mint、交易 hash、接收地址、链上 NFT 地址和 `job_runs`。手工触发 `reconcile-mints` 前先确认没有 10 分钟内的活动租约；并发触发应记录 `skipped`。链上事实只能由对账 RPC 写回。

## Monster Tamer 静态游戏

`/monster-tamer` 或 `/monster-tamer/` 返回 SPA、404 或资源加载失败时，先核对 Vercel 重写顺序、当前 commit 的 `apps/web/public/monster-tamer` 文件清单和大小写敏感资源路径，再部署包含完整静态树的修正 commit。不得通过修改 FinalTMA API、数据库、session、Catalog 或用户资产恢复游戏。

存档无法读取时只检查浏览器对 `MONSTER_TAMER_DATA` 的可用性和内容解析日志，不得读取、迁移或清除其他 FinalTMA 存储；恢复部署不得主动删除该键。发现静态游戏请求 `/api/*`、Supabase、Catalog、FinalTMA token 或业务用户数据时立即停止该版本发布并恢复符合独立边界的静态 commit。

发现图片没有直接授权证据、许可证或第三方声明缺失时停止该版本发布，补齐项目原创替换和声明后重新执行完整玩法与静态资源验收；不得以隐藏文件、关闭检查或删除玩法绕过。

## 不变量

运行 `monitor-invariants`，处理 `BALANCE_LEDGER_MISMATCH`、`DUPLICATE_PAYMENT_DELIVERY`、`RESERVATION_OVERFLOW`、`ILLEGAL_RESERVATION` 和 `OPEN_OPERATION_WITHOUT_SUBJECT`。正式生产上线前的结构修复直接修改原始声明式 Schema，并从空真实开发数据库重建三条迁移；正式生产上线后的数据修复使用审计过的前向 SQL 或既有 RPC。任何阶段都保存变更前后证据且不直接改写账本历史。
