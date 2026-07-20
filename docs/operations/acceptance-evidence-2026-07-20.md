# 用户与登录修复真实环境验收证据（2026-07-20）

## 发布对象

- 环境：真实开发 `final-tma-real-test / ebewtjerusxcioegpzjd` 与 Vercel `final-tma` Production。
- Git commit：`2b46485aa7768d4046afc550a073e21cc9037582`。
- Vercel deployment：`dpl_8pmym85Cdfej3YJLmTZRvqDGz6Gd`，状态 `READY`，Node `24.x`，Production alias `https://final-tma-pi.vercel.app`。
- Production 配置：`TELEGRAM_BOT_USERNAME=FinalTMA_bot`，`TELEGRAM_MINI_APP_SHORT_NAME=pokepets_dev`；配置变更已由上述新部署生效。
- Migration：
  - `20260719104533_baseline.sql`：`805caee83973310e5e100fe61bb2dd6c839e11d9c3b018d7385d76394dcc0cb4`
  - `20260719104602_product_data_v1.sql`：`604889bdd5a0a72d7b17d428e64e024e1b596c21a7bda62f978351b8753fa7f9`
  - `20260719104614_api_security.sql`：`2db846b16e66015fbfb8d05647be1c604a49385b42e7b97ce06a7be24e53212f`

数据库已清空项目自有的 18 个业务 Schema 和 migration history，并从第一条开始连续执行以上三条原始 migration。远程 migration 列表只包含这三个版本。最终结构为 18 个业务 Schema、43 张表、43 张表启用 RLS、`public` 可执行 RPC 数量为 0；交接 helper、默认门禁、`referral.bind` 写入完成时间、`operations.begin_command` 例外和 `operations_get` 查询例外均已核对。

Supabase Security Advisor 只有 43 条 `INFO / rls_enabled_no_policy`，与项目拒绝浏览器直连的外围 RLS 设计一致；Performance Advisor 只有 18 条未索引外键和 33 条空库未使用索引 INFO，没有 WARN 或 ERROR。Vercel 新部署烟测期间没有 5xx 日志。

## 自动门禁与真实 API 证据

| 场景                                    | 实际结果                                                                                   | request_id                             | operation_id                           | 结论 |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------- | ---- |
| 健康检查                                | `GET /api/health` 返回 200                                                                 | `5b4be0f6-2719-484e-846d-a6f9a06cdf32` | `null`                                 | PASS |
| 完成交接的邀请信息                      | 返回 200；链接为 `https://t.me/FinalTMA_bot/pokepets_dev?startapp=TMA0123456789ABCDEF0123` | `26750c85-4252-4ec7-99f0-55b49445bf4d` | `null`                                 | PASS |
| pending 会话直接读取邀请信息            | 返回 409 `ENTRY_HANDOFF_PENDING`                                                           | `23f45b91-43c1-459e-b1e4-5455427824cc` | `null`                                 | PASS |
| pending 会话直接读取首屏                | 返回 409 `ENTRY_HANDOFF_PENDING`                                                           | `42e53ad6-7478-491f-b0a1-2f2f4f2cc7f2` | `null`                                 | PASS |
| pending 会话直接读取开盒业务            | 返回 409 `ENTRY_HANDOFF_PENDING`                                                           | `a71e5020-827b-4069-a963-c120adbb99f2` | `null`                                 | PASS |
| pending 会话绑定合法邀请                | 返回 200 `REFERRAL_BOUND`                                                                  | `6c42b28b-1ef6-40ab-a5c6-b42fca9aafe5` | `a11ce000-0000-4000-8000-000000000004` | PASS |
| 同 operation 幂等回放                   | 返回同一 200 结果                                                                          | `ae7ce48b-4509-4358-b4b2-0326916343a2` | `a11ce000-0000-4000-8000-000000000004` | PASS |
| 绑定后读取首屏                          | 返回 200，数据库资产为 0                                                                   | `d9fb7e2e-b702-4680-8e62-1161c975e945` | `null`                                 | PASS |
| 绑定后读取邀请信息                      | 返回 200，链接包含 Bot、`pokepets_dev` 和当前邀请码                                        | `94f9ae19-ef1c-4bb5-ab3f-9c6d3392430e` | `null`                                 | PASS |
| 查询已完成的原邀请操作                  | 返回 200 `succeeded`                                                                       | `e1a57652-26d6-4550-9204-77d9fc5f5a52` | `a11ce000-0000-4000-8000-000000000004` | PASS |
| pending 会话查询原 `referral.bind` 操作 | 返回 200                                                                                   | `fdc95e90-5041-4bc1-92f7-4a464ba37c17` | `a11ce000-0000-4000-8000-000000000004` | PASS |
| pending 会话查询其他业务操作            | 返回 409 `ENTRY_HANDOFF_PENDING`                                                           | `7ca519d1-aa4d-4b89-9e39-3eb386b95628` | `null`                                 | PASS |
| pending 会话回放已完成邀请操作          | 返回同一 200 结果并补齐当前会话完成时间                                                    | `9875a66c-c87d-4c8e-b93b-b088c96c5d87` | `a11ce000-0000-4000-8000-000000000004` | PASS |

绑定前数据库状态为会话 `referral_processed_at = NULL`、候选 `pending`、关系数 0。首次成功及多次回放后为会话已完成、候选 `bound / REFERRAL_BOUND`、候选 operation 为 `a11ce000-0000-4000-8000-000000000004`、关系数 1、该 operation 记录数 1。验收账号按邀请人后邀请人的顺序删除，级联清理后用户、会话、候选、邀请关系和操作记录数量均为 0；验收令牌未保留。

## 本地和契约门禁

format、lint、TypeScript、contract/OpenAPI、数据库静态同步、架构检查和生产 build 均通过。完整 `validate:static` 在本机执行到 Docker 数据库检查时因 Docker daemon 未运行而停止；同一组整理后的 migration 随后已在空的真实开发数据库连续执行，并完成远程结构、权限、RLS 与 Advisor 核验。

## 第 16.11 节剩余真实设备验收

本文件没有把第 16.11 节 21 项虚报为全部通过。以上证据完成了第 10 项的服务端绕过门禁、邀请绑定、操作恢复、幂等与邀请链接部分，也为第 7、14 项提供了服务端状态依据。下列用户可见和设备行为仍必须由验收人在真实 Telegram 客户端执行并保存截图：真实 initData 的首次、再次、并发、签名与时间边界、限流、15 分钟会话生命周期、初始及使用中封禁的 DOM 与迟到响应、恢复 generation、摘要局部失败，以及 iOS、Android、Telegram Desktop、Telegram Web 的浅色、深色、安全区和视口变化。上述真实客户端证据齐全前，第 16.11 节整体结论为 `未完成`。
