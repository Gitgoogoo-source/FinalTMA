# 推广来源归因操作手册

本功能用于回答“每一条推广链接带来了多少新用户”。数据库已经承载真实用户；任何来源操作都禁止清库、重建 migration history、修改旧 migration、删除历史来源或尝试倒推旧用户。

## 1. 注册独立推广链接

来源管理只能在受控的数据库 Owner 会话执行。先读取并人工核对目标身份：

```sql
select environment, project_ref, bound_at
from admin.database_identity
where singleton;
```

每一个需要独立统计的“平台 + campaign + ad group + creative”组合注册一条来源。下面两个调用仅是字段格式示例；执行时必须把尖括号内容替换为控制台已确认的真实值，不得把占位符直接执行，也不得在代码或聊天中暴露密钥：

```sql
select admin.acquisition_source_register(
  p_environment => '<verified_environment>',
  p_project_ref => '<verified_project_ref>',
  p_source_code => 'adsgram_<campaign>_<creative>',
  p_channel_code => 'paid_ad',
  p_platform_code => 'adsgram',
  p_campaign_code => '<campaign>',
  p_ad_group_code => '<ad_group_or_null>',
  p_creative_code => '<creative_or_null>',
  p_link_label => '<human-readable label>'
);

select admin.acquisition_source_register(
  p_environment => '<verified_environment>',
  p_project_ref => '<verified_project_ref>',
  p_source_code => 'tads_<campaign>_<creative>',
  p_channel_code => 'paid_ad',
  p_platform_code => 'tads',
  p_campaign_code => '<campaign>',
  p_ad_group_code => '<ad_group_or_null>',
  p_creative_code => '<creative_or_null>',
  p_link_label => '<human-readable label>'
);
```

函数返回数据库生成的 `start_param`。最终投放链接必须逐字拼成：

```text
https://t.me/EvoMyPet_bot/evomypet?startapp=<returned_start_param>
```

同一个 `source_code` 和完全相同的字段重复调用会返回原参数并标记 `replayed=true`；同名但字段不同会拒绝，避免历史口径漂移。不得手工生成 `SRC_` 参数，不得复用一条链接代表多个需要单独统计的素材，也不得把玩家推荐码或 Battle token 当作广告来源。

## 2. 查询与停用

列出全部来源：

```sql
select * from admin.acquisition_sources();
```

停止某条链接继续带来新登录，但保留历史归因：

```sql
select admin.acquisition_source_disable(
  p_environment => '<verified_environment>',
  p_project_ref => '<verified_project_ref>',
  p_source_code => '<existing_source_code>'
);
```

固定来源 `legacy_unknown`、`telegram_direct`、`tgapp_listing`、`player_referral` 与 `battle_share` 不可停用。普通来源停用后，相同链接的新认证会返回入口参数错误；已经归因的用户、session、login request 和报表历史不会删除或改写。

## 3. 查看归因报表

时间窗口采用左闭右开 UTC：

```sql
select *
from admin.acquisition_report(
  '2026-09-01 00:00:00+00'::timestamptz,
  '2026-09-02 00:00:00+00'::timestamptz
);
```

- `new_users`：窗口内创建、且 `first_source_code` 等于该来源的账号；这是广告链接带来用户数的主指标。
- `unique_login_users` / `successful_logins`：窗口内以该来源完成登录的独立账号和 session 数，包含老用户回访，不等同于新增。
- `activated_users`：该窗口注册 cohort 中，曾至少推进一次单抽或十连日任务的用户。
- `d1_*` / `d7_*`：只统计目标 UTC 日已经完整结束的可观察 cohort；留存由对应日期存在成功 session 判定。
- `payer_users` / `gross_stars` / `refund_stars` / `net_stars`：窗口注册 cohort 截至查询时的累计 Telegram Stars 结果，不是支付发生时间窗口。

报表只返回来源维度和聚合数字，不返回 Telegram ID、用户名或玩家明细。需要跨天报表时固定保存查询 UTC 边界和执行时间，避免把不同 cohort 或尚未完整结束的 D1/D7 混在一起。

## 4. 发布与数据保全门禁

先执行静态检查和 migration dry-run，再在已核对的目标项目追加执行前向 migration。执行前后至少保存以下匿名聚合：

```sql
select 'users' as relation, count(*) from identity.users
union all
select 'sessions', count(*) from identity.sessions
union all
select 'login_requests', count(*) from identity.login_requests;
```

迁移后旧行的来源应全部为 `legacy_unknown`，三张表行数必须与迁移前一致；新来源表应有五条固定来源。禁止运行 `supabase db reset`、远端数据库重建、migration repair、`TRUNCATE` 或业务表 `DELETE`。应用部署完成并验证新版认证 RPC 后才能把新 `SRC_` 链接交给 AdsGram、TADS 或其他渠道。
