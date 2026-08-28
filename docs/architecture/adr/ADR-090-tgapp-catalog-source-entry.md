# ADR-090：Tg.app 目录来源参数精确直接入口

- 状态：已接受
- 日期：2026-08-28

## 背景

EvoMyPet 的生产 named Mini App 链接为 `https://t.me/EvoMyPet_bot/evomypet`。Tg.app 当前在 Mini App Listing 的 `Open in Telegram` 链接上附加 `startapp=listed_on_tg_app`；Telegram 会把非空 `startapp` 作为 `start_param` 放入 Mini App 的启动信息。现有身份入口只接受空值、推荐码和 Battle token，因此该目录来源值原本会被归类为 `invalid`，导致从 Tg.app 打开的玩家在创建账号与 session 前被拒绝。

把 Listing 降级为 Bot 根链接会失去 named Mini App 直达能力；伪造推荐码会改变邀请归属；允许任意未知参数会扩大身份入口可信边界。这三种处理均不接受。

## 唯一结论

服务端只在 Telegram `initData` 完成签名、用户、授权时间和来源限流校验后读取 `start_param`。该值完全等于、且大小写精确匹配 `listed_on_tg_app` 时，入口分类器返回现有 `direct`，推荐码与 Battle token hash 均为空。空值继续返回 `direct`，合法 `TMA` 推荐码继续返回 `referral`，合法 `BTL_` token 继续返回 `battle`，任何其他未知或近似值继续返回 `invalid`。

不得读取未经服务端验签的 URL 查询参数作为身份入口依据；不得使用前缀、后缀、包含、忽略大小写或正则宽匹配接受 Tg.app 来源值。

## 数据与业务边界

`listed_on_tg_app` 只是一项外部分发目录的固定来源标记，不是新业务入口类型。API 契约、`identity.sessions`、`identity.login_requests` 和数据库 RPC 继续只使用 `direct`、`referral` 与 `battle`，数据库不保存原始来源值，不新增字段、枚举、索引或 migration。

由 Tg.app 形成的 `direct` 不创建 `identity.entry_candidates`，不创建 `referral.bind` 操作，不绑定邀请关系，不发放邀请奖励，也不生成或消费 Battle token。账号此前已经存在的 `pending` 推荐候选仍按现有 `referral_processed_at` 门禁继续处理，最新的 `direct` 启动不能新增、删除、替换或绕过该候选。

本裁决不增加自定义分析事件或内部渠道归因。Tg.app Creator Studio 的目录浏览、打开和转化统计继续由 Tg.app 自身提供；如果未来需要在 EvoMyPet 内建立渠道归因，必须另行裁决数据范围、保留期限和隐私披露，不能混入身份认证修改。

## 静态与真实设备门禁

静态架构检查必须同时锁定精确常量比较、推荐与 Battle 原有格式、未知值的 `invalid` 回退，以及数据库只在“新用户且 `entry_kind = referral`”时创建候选。实现不通过模糊匹配，也不能把 `listed_on_tg_app` 下沉到数据库。

发布前使用同一 Git commit 的真实 iPhone Telegram Mini App 与 Safari Web Inspector 打开完整链接 `https://t.me/EvoMyPet_bot/evomypet?startapp=listed_on_tg_app`，证明认证成功、进入默认开盒页、session 与 login request 均为 `direct`、推荐码和 Battle hash 为空，并通过前后数据库证据证明没有邀请候选、绑定、邀请关系或奖励副作用。同时回归无参数 named、合法推荐、合法 Battle、大小写变化、前后缀和其他未知参数。静态检查、桌面浏览器或人工拼接请求不能替代该真机结论。

## 关联裁决

本 ADR 补充 ADR-002，并只为 Tg.app 当前固定目录来源值增加一个精确的 `direct` 别名；不改变 Telegram 身份、推荐、Battle、会话、数据库或分析规则。Tg.app 如果更改来源参数，不得自动放宽匹配，必须重新核对平台当前实现并形成新的明确裁决。
