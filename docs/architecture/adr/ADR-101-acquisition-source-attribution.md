# ADR-101：Telegram 推广链接首来源归因

- 状态：已接受
- 日期：2026-09-02

## 背景

AdsGram、TADS 与目录渠道都通过 Telegram named Mini App 链接进入 EvoMyPet。历史实现只把启动参数归类为 `direct`、`referral` 或 `battle`，没有保存每个推广链接的独立来源，因此无法从项目数据库回答每个平台、活动、广告组或素材分别带来多少新用户。数据库已经承载真实用户，既有三份 migration 和历史业务数据均不可清空、重建、改写或伪造回填。

## 唯一结论

推广归因只信任 Telegram 签名覆盖的 `initData.start_param`。运营先通过数据库 Owner 专用的 `admin.acquisition_source_register` 注册一条来源，数据库生成不可预测且唯一的 `SRC_[A-F0-9]{20}` 启动参数；投放链接固定为 `https://t.me/EvoMyPet_bot/evomypet?startapp=<start_param>`。前端 URL、浏览器查询参数、Referer、广告平台回传或客户端自报字段都不能决定来源。

每条推广链接对应 `acquisition.sources` 的一个不可复用 `start_param`，并保存稳定的 `source_code`、渠道、平台、活动、广告组、素材、可读标签与启停状态。`source_code` 和已生成的 `start_param` 不允许修改；需要新的维度组合时创建新来源。停用只阻止该链接产生新的登录，不删除历史记录。无参数、Tg.app、玩家推荐和 Battle 分享分别使用固定来源 `telegram_direct`、`tgapp_listing`、`player_referral` 与 `battle_share`。

## 归因与身份边界

`identity.users.first_source_code` 保存首次账号创建来源，创建后永久不被后续登录覆盖；这是“该推广链接带来多少新用户”的唯一事实来源。`identity.sessions.source_code` 与 `identity.login_requests.source_code` 保存每次已验证登录的来源，用于登录次数与回访分析。已有账号、session 和 login request 因历史启动参数未被保存，统一且只允许回填 `legacy_unknown`，不得根据创建时间、广告开始时间、用户名、推荐关系或平台报表倒推来源。

`entry_kind` 继续只允许 `direct`、`referral` 与 `battle`。注册的推广参数和 `listed_on_tg_app` 都属于 `direct`，不得创建或改变 `identity.entry_candidates`、邀请关系、邀请奖励、Battle token 或资产。`TMA[A-F0-9]{20}` 推荐码与 `BTL_` Battle token 的既有格式、哈希和交接规则保持不变。格式正确但未注册、已停用或大小写改变的推广参数统一返回现有入口参数错误，并且不创建账号、session 或 login request。

## 报表口径与权限

`admin.acquisition_report(from, to)` 仅供数据库 Owner 执行，按来源返回：时间窗内首次注册用户、时间窗内独立登录用户和成功 session 数、注册 cohort 的开盒激活用户、完整 UTC 日的 D1/D7 可观察人数与留存人数，以及该注册 cohort 截至查询时的 Telegram Stars 付费人数、总额、退款额和净额。激活固定定义为该用户的 `gacha_1`、`gacha_10` 或 `gacha_ten` 日任务进度曾大于零；不使用有期限的 operation 历史推断。报表不返回 Telegram ID、用户名或其他玩家标识。

`acquisition` 与 `admin` 都不进入 Data API exposed schemas；对 `PUBLIC`、`anon`、`authenticated` 与 `service_role` 撤销 schema、表和函数权限。应用的 `service_role` 只获得新版 `api.identity_authenticate` 的执行权，不能列出来源或读取报表。来源注册、停用和报表调用都必须由 Owner 完成，写操作还必须核对 `admin.database_identity` 的环境与 project ref。

## 迁移与发布

既有 `baseline`、`product_data_v1`、`api_security` 三份 migration 的字节与 SHA-256 永久冻结。本功能只追加 `acquisition_attribution` 前向 migration：先创建固定来源，再为三张身份表添加可空字段，把全部旧行更新为 `legacy_unknown`，最后添加非空、外键和索引；整个 migration 在单一事务中执行，失败则整体回滚。它不包含 `TRUNCATE`、业务数据 `DELETE`、表/schema 删除或 migration history 重建。

新版认证 RPC 的来源参数位于末尾并带默认空值，数据库先迁移时仍兼容尚未切换的旧 Function 调用。应用部署完成前不得开始使用 `SRC_` 投放链接；部署后也只有已注册且启用的参数可以登录。

## 验收

发布前必须证明旧三份 migration 校验和未变、前向 migration dry-run 只包含预期 DDL/回填、升级前后用户/session/login request 行数不变且旧行全部为 `legacy_unknown`。随后验证新注册链接的首次账号归因、同账号跨来源重登不覆盖首来源、session 来源更新、幂等重放、未知/停用参数拒绝、推荐/Battle 零副作用、RLS 与角色权限以及报表聚合。

真实入口最终以同一 Git commit 的 iPhone Telegram Mini App 和 Safari Web Inspector 验收；静态检查、SQL 测试、部署 `READY` 或广告平台点击数均不能替代该结论。

## 关联裁决

本 ADR 扩展 [ADR-002](ADR-002-identity-and-session.md)，并替代 [ADR-090](ADR-090-tgapp-catalog-source-entry.md) 中“数据库不保存目录来源且不建立内部归因”的旧限制；ADR-090 对 `listed_on_tg_app` 精确匹配、`direct` 入口及推荐/Battle 零副作用的约束继续有效。
