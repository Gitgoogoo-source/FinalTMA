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

## Monster Tamer 嵌入式游戏

入口无法打开时先核对主应用会话、账号门禁、React 覆盖层和 Phaser 延迟 chunk；`/monster-tamer` 与 `/monster-tamer/` 应进入主应用而不是独立文档。禁止临时恢复旧公开 HTML、本地怪兽、本地存档或绕过认证。

bootstrap 或进度无法读取时按 `request_id` 核对 session、`monster_tamer.player_progress`、权威区域与 `resume_position`、可用藏品投影和契约输出。版本、路径、节点或遭遇位置冲突必须刷新权威快照并让 Phaser 回到服务端坐标；不得直接降低版本、手写进度或绕过固定 `walkable` 资料。活动战斗恢复失败时查询原 `battle_id` 和原 `operation_id`，不能另开一场代替未知结果。

藏品在营地、区域进入或战斗开始前失效时，固定回营刷新并重新组队，不得恢复旧 available 快照。目录图片故障只恢复同模板正式路径，不能复制另一模板或本地占位怪兽。

任何事故处理中都不得修改 holdings、reservations、余额、账本、远征、市场、进化、分解、Mint、任务、邀请、VIP 或支付来“修复”游戏。若发现 Phaser 直接持有 token/API、客户端提交伤害或胜负、浏览器持久化进度或公开免登录入口，立即停止该版本并恢复到满足 ADR-011 的兼容提交。

## 不变量

运行 `monitor-invariants`，处理 `BALANCE_LEDGER_MISMATCH`、`DUPLICATE_PAYMENT_DELIVERY`、`RESERVATION_OVERFLOW`、`ILLEGAL_RESERVATION` 和 `OPEN_OPERATION_WITHOUT_SUBJECT`。正式生产上线前的结构修复直接修改原始声明式 Schema，并从空真实开发数据库重建三条迁移；正式生产上线后的数据修复使用审计过的前向 SQL 或既有 RPC。任何阶段都保存变更前后证据且不直接改写账本历史。
