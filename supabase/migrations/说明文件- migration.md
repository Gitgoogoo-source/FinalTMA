已生成完整 `supabase/migrations` 迁移文件，共 **19 个 SQL 文件，约 4639 行**，可直接解压到项目根目录使用。

下载： [tmaGame_supabase_migrations_0001_0019.zip](sandbox:/mnt/data/tmaGame_supabase_migrations_0001_0019.zip)

压缩包内路径：

```txt
tmaGame/
└── supabase/
    └── migrations/
        ├── 0001_create_users.sql
        ├── 0002_create_economy_ledger.sql
        ├── 0003_create_catalog_collectibles.sql
        ├── 0004_create_gacha_boxes.sql
        ├── 0005_create_inventory.sql
        ├── 0006_create_market.sql
        ├── 0007_create_payments_stars.sql
        ├── 0008_create_tasks_referrals.sql
        ├── 0009_create_album_leaderboard.sql
        ├── 0010_create_onchain_nft.sql
        ├── 0011_create_ops_admin_audit.sql
        ├── 0012_create_views_public.sql
        ├── 0013_create_rpc_auth.sql
        ├── 0014_create_rpc_gacha.sql
        ├── 0015_create_rpc_market.sql
        ├── 0016_create_rpc_inventory.sql
        ├── 0017_create_rpc_tasks_album_wallet.sql
        ├── 0018_create_rls_policies.sql
        └── 0019_create_constraints.sql
```

这些迁移文件包含：

```txt
1. 用户系统
   - Telegram 用户
   - 用户资料
   - App session
   - TON 钱包地址
   - wallet proof
   - 用户风控标记
   - 用户通知

2. 资产系统
   - KCOIN
   - FGEMS
   - XTR / Telegram Stars 记录
   - user_balances
   - currency_ledger 不可变流水
   - balance_locks
   - reward_rules
   - fee_rules

3. 藏品配置
   - 稀有度
   - 类型
   - 系列
   - 阵营
   - 藏品模板
   - 三段形态
   - 图片素材
   - 战力规则
   - 市场参考价格规则
   - 活动 banner

4. 开盒抽卡
   - 盲盒表
   - 价格规则
   - 奖励池版本
   - 奖励池条目
   - 保底规则
   - 用户保底状态
   - 开盒订单
   - 抽卡结果
   - 抽卡审计

5. 库存系统
   - 用户藏品实例
   - 库存锁
   - 库存事件
   - 升级规则
   - 升级记录
   - 合成 / 进化规则
   - 合成尝试
   - 合成材料消耗记录
   - 分解规则
   - 分解记录

6. 交易市场
   - 挂单
   - 挂单藏品实例
   - 订单
   - 订单藏品
   - 挂单事件
   - 价格快照
   - 市场深度
   - 价格健康规则
   - 手续费结算

7. Telegram Stars 支付
   - Stars 订单
   - invoice 记录
   - successful_payment 记录
   - webhook 原始事件
   - 退款
   - 支付争议

8. 任务与邀请
   - 任务模板
   - 用户任务进度
   - 任务领取
   - 7 日签到
   - 邀请关系
   - 首次开盒双方奖励
   - 好友开盒 10% 分红
   - 分享事件

9. 图鉴与排行榜
   - 图鉴册
   - 图鉴条目
   - 用户首次发现记录
   - 图鉴里程碑
   - 里程碑领取
   - 周榜
   - 排行榜条目
   - 积分规则

10. TON 链上 NFT
    - NFT Collection
    - NFT Item
    - Mint 队列
    - 链上交易
    - 钱包同步任务
    - 钱包 NFT 快照

11. 后台运营
    - 管理员
    - 管理员角色
    - 后台审计日志
    - 功能开关
    - 系统设置
    - 风控事件
    - 幂等键
    - API 限流
    - 客服工单
    - App 事件

12. RPC 事务函数
    - Telegram 用户创建 / 更新
    - 创建 session
    - 获取用户首屏数据
    - 创建开盒订单
    - 支付成功后抽卡发货
    - 创建市场挂单
    - 购买挂单
    - 改价
    - 下架
    - 升级
    - 合成
    - 分解
    - 签到
    - 任务领取
    - 邀请首开盒奖励
    - 邀请分红
    - 图鉴奖励领取
    - 保存 TON 钱包地址
    - 创建 Mint 队列
    - 标记 Mint 成功

13. 安全控制
    - RLS policies
    - 前端只读策略
    - 业务写操作仅后端 service_role 执行
    - ledger 防 update / delete
    - 防重复支付
    - 防重复领取
    - 防重复挂售
    - 防库存双花
    - 防同一藏品同时挂售 / 合成 / 分解 / Mint

14. 约束、索引、触发器
    - 外键
    - 唯一索引
    - 部分唯一索引
    - 性能索引
    - updated_at trigger
    - 奖励池权重自动刷新
    - 图鉴发现自动记录
    - 市场挂单数量校验
```

我没有连接你的 Supabase 实例执行 `db push`，所以建议你解压后先在本地运行：

```bash
supabase db reset
```

或：

```bash
supabase migration up
```

如果你的 Supabase CLI 要求时间戳格式迁移名，可以把 `0001_...sql` 改成类似：

```txt
20260520000100_create_users.sql
20260520000200_create_economy_ledger.sql
...
```

但文件内容不需要改。
