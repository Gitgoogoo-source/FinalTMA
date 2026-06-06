下面是一份可以直接放进开发文档的 **图鉴功能业务全流程设计**。核心原则是：

```text
图鉴点亮 = 用户曾经合法获得过该藏品
当前拥有数量 = 用户仓库当前还有多少
图鉴奖励 = 根据图鉴永久解锁记录判断，而不是根据当前仓库判断
```

---

# 1. 图鉴功能涉及的数据表

建议最少需要这 5 张表。

| 表名                              | 作用              |
| ------------------------------- | --------------- |
| `collectibles`                  | 所有藏品基础信息        |
| `user_inventory`                | 用户当前仓库，记录当前拥有数量 |
| `user_collectible_unlocks`      | 用户图鉴永久解锁记录      |
| `collection_chains`             | 图鉴进化链配置         |
| `collection_chain_nodes`        | 每条进化链包含哪些藏品     |
| `user_collection_chain_rewards` | 用户领取图鉴链条奖励记录    |

重点是这张表：

```sql
user_collectible_unlocks
```

它表示：

```text
用户曾经获得过某个藏品，因此图鉴永久点亮。
```

不是表示当前库存。

---

# 2. 推荐表关系 ERD

```mermaid
erDiagram
    USERS ||--o{ USER_INVENTORY : owns_current_items
    USERS ||--o{ USER_COLLECTIBLE_UNLOCKS : unlocks_album_items
    USERS ||--o{ USER_COLLECTION_CHAIN_REWARDS : claims_chain_rewards

    COLLECTIBLES ||--o{ USER_INVENTORY : inventory_item
    COLLECTIBLES ||--o{ USER_COLLECTIBLE_UNLOCKS : unlocked_item
    COLLECTIBLES ||--o{ COLLECTION_CHAIN_NODES : chain_node

    COLLECTION_CHAINS ||--o{ COLLECTION_CHAIN_NODES : has_nodes
    COLLECTION_CHAINS ||--o{ USER_COLLECTION_CHAIN_REWARDS : reward_claim

    USERS {
        uuid id PK
        text telegram_id
        timestamptz created_at
    }

    COLLECTIBLES {
        uuid id PK
        text name
        text rarity
        text series
        text faction
        text thumbnail_url
        text image_url
        boolean is_active
    }

    USER_INVENTORY {
        uuid user_id FK
        uuid collectible_id FK
        integer quantity_available
        integer quantity_locked
        timestamptz updated_at
    }

    USER_COLLECTIBLE_UNLOCKS {
        uuid user_id FK
        uuid collectible_id FK
        timestamptz first_unlocked_at
        text first_source
        text first_source_event_id
    }

    COLLECTION_CHAINS {
        uuid id PK
        text name
        text series
        text reward_type
        integer reward_amount
        integer sort_order
        boolean is_active
    }

    COLLECTION_CHAIN_NODES {
        uuid id PK
        uuid chain_id FK
        uuid collectible_id FK
        integer node_order
    }

    USER_COLLECTION_CHAIN_REWARDS {
        uuid user_id FK
        uuid chain_id FK
        text reward_type
        integer reward_amount
        timestamptz claimed_at
    }
```

---

# 3. 图鉴核心业务规则

| 场景        | 是否写入 `user_collectible_unlocks` | 是否改变图鉴点亮状态 |
| --------- | ------------------------------: | ---------: |
| 开盲盒获得藏品   |                               是 |         点亮 |
| 市场购买藏品    |                               是 |         点亮 |
| 合成成功获得新藏品 |                               是 |      点亮新藏品 |
| 活动奖励获得藏品  |                               是 |         点亮 |
| 后台发放藏品    |                               是 |         点亮 |
| 图鉴链奖励发放藏品 |                     如果奖励是藏品，则写入 |         点亮 |
| 出售藏品      |                               否 |      不取消点亮 |
| 分解藏品      |                               否 |      不取消点亮 |
| 合成消耗材料藏品  |                               否 |      不取消点亮 |
| Mint 上链   |                               否 |      不取消点亮 |
| 挂单出售      |                               否 |      不取消点亮 |

结论：

```text
只要用户曾经获得过，就永久点亮。
用户卖掉、分解、合成消耗、mint 后，图鉴不回退。
```

---

# 4. 图鉴完整总流程 Mermaid

```mermaid
flowchart TD
    A[用户获得藏品的来源] --> B1[开盲盒获得]
    A --> B2[交易市场购买]
    A --> B3[合成/进化成功]
    A --> B4[活动奖励获得]
    A --> B5[后台管理员发放]
    A --> B6[图鉴奖励获得藏品]

    B1 --> C[进入统一发放藏品事务 grant_collectible]
    B2 --> C
    B3 --> C
    B4 --> C
    B5 --> C
    B6 --> C

    C --> D[校验用户身份和业务合法性]
    D --> E[写入或增加 user_inventory 当前库存]
    E --> F[UPSERT user_collectible_unlocks 图鉴永久解锁]
    F --> G[写入来源业务记录]
    G --> H[写入资产/库存流水]
    H --> I[提交数据库事务]
    I --> J[前端收到获得藏品结果]

    J --> K{用户是否打开图鉴}
    K -->|否| L[流程结束]
    K -->|是| M[GET /api/album/overview]

    M --> N[读取所有 collection_chains]
    N --> O[读取 collection_chain_nodes]
    O --> P[读取用户 user_collectible_unlocks]
    P --> Q[读取 user_inventory 当前拥有数量]
    Q --> R[读取 user_collection_chain_rewards 领奖记录]
    R --> S[后端计算每条链状态]

    S --> T{链条状态}
    T -->|一个都没解锁| U[locked 全部问号]
    T -->|部分解锁| V[collecting 已解锁头像 + 未解锁问号]
    T -->|全部解锁未领奖| W[claimable 显示彩色礼物盒]
    T -->|全部解锁已领奖| X[claimed 显示已领取礼物盒]

    U --> Y[前端渲染图鉴弹窗]
    V --> Y
    W --> Y
    X --> Y

    Y --> Z{用户点击内容}
    Z -->|点击已解锁头像| ZA[显示宠物缩略图和当前拥有数量]
    Z -->|点击未解锁问号| ZB[显示问号缩略图/藏品名称/获取方式]
    Z -->|点击礼物盒| ZC[POST /api/album/claim-chain-reward]

    ZB --> ZB1[去交易市场购买]
    ZB --> ZB2[去开盲盒蛋]

    ZB1 --> ZB3[跳转市场并筛选 collectible_id]
    ZB2 --> ZB4[跳转开蛋页并推荐可产出该藏品的蛋]

    ZC --> ZD[后端校验链条是否全部解锁]
    ZD --> ZE[校验是否已经领取过]
    ZE --> ZF[发放奖励]
    ZF --> ZG[写入奖励流水]
    ZG --> ZH[写入 user_collection_chain_rewards]
    ZH --> ZI[返回领取成功]
    ZI --> ZJ[前端展示奖励弹窗]
```

---

# 5. 和开盲盒功能的连接流程

开盲盒是图鉴最重要的数据来源之一。

```mermaid
flowchart TD
    A[用户点击开盲盒] --> B[前端请求开盒接口]
    B --> C[后端校验 session]
    C --> D[校验支付/余额/开盒次数]
    D --> E[读取盲盒概率配置]
    E --> F[随机抽取藏品结果]
    F --> G[开始数据库事务]

    G --> H[扣除开盒成本或确认支付订单]
    H --> I[写入 box_open_records 开盒记录]
    I --> J[增加 user_inventory 当前库存]
    J --> K[UPSERT user_collectible_unlocks 图鉴解锁记录]
    K --> L[写入 inventory_ledger 库存流水]
    L --> M[写入 currency_ledger 资产流水]
    M --> N[提交事务]

    N --> O[返回开盒结果给前端]
    O --> P[前端展示获得藏品动画]
    P --> Q{该藏品是否第一次解锁}
    Q -->|是| R[显示 新图鉴点亮 提示]
    Q -->|否| S[显示 已拥有数量增加]
```

开盒成功后，不需要前端再单独请求“图鉴同步接口”。

正确做法是：

```text
开盒事务内部自动 upsert 图鉴解锁记录。
```

---

# 6. 和交易市场购买功能的连接流程

用户从市场购买藏品后，也要点亮买家的图鉴。

```mermaid
flowchart TD
    A[用户点击购买市场藏品] --> B[前端请求购买接口]
    B --> C[后端校验买家 session]
    C --> D[校验 listing 是否存在]
    D --> E[校验 listing 是否仍在出售]
    E --> F[校验买家余额是否足够]
    F --> G[开始数据库事务]

    G --> H[扣除买家支付金额]
    H --> I[计算平台手续费]
    I --> J[增加卖家可结算收入]
    J --> K[减少卖家锁定库存或完成库存转移]
    K --> L[增加买家 user_inventory 当前库存]
    L --> M[UPSERT 买家 user_collectible_unlocks]
    M --> N[写入 market_trades 交易记录]
    N --> O[写入买卖双方资产流水]
    O --> P[写入库存流水]
    P --> Q[提交事务]

    Q --> R[返回购买成功]
    R --> S[前端提示购买成功]
    S --> T[买家图鉴中该藏品被永久点亮]
```

注意：

```text
卖家出售藏品，不会取消卖家的图鉴点亮。
买家购买藏品，会点亮买家的图鉴。
```

---

# 7. 和合成/进化功能的连接流程

例如：

```text
3 个小火龙 → 1 个火恐龙
```

合成成功后，用户获得新藏品，需要点亮新藏品。

```mermaid
flowchart TD
    A[用户点击合成/进化] --> B[前端提交材料藏品]
    B --> C[后端校验 session]
    C --> D[校验材料数量是否足够]
    D --> E[校验材料是否可用]
    E --> F[校验合成规则]
    F --> G[计算成功率]
    G --> H[开始数据库事务]

    H --> I[扣除材料藏品库存]
    I --> J{是否合成成功}

    J -->|失败| K[不发放新藏品]
    K --> L[写入合成失败记录]
    L --> M[写入库存/资产流水]
    M --> N[提交事务]
    N --> O[前端展示合成失败]

    J -->|成功| P[发放目标藏品]
    P --> Q[增加 user_inventory 目标藏品库存]
    Q --> R[UPSERT user_collectible_unlocks 解锁目标藏品]
    R --> S[写入合成成功记录]
    S --> T[写入库存/资产流水]
    T --> U[提交事务]
    U --> V[前端展示合成成功]
    V --> W[图鉴中目标藏品永久点亮]
```

注意：

```text
被消耗的材料藏品，不会从图鉴中熄灭。
```

例如用户用 3 个小火龙合成火恐龙，合成后仓库里可能没有小火龙了，但图鉴里“小火龙”仍然点亮。

---

# 8. 和分解功能的连接流程

分解只影响仓库，不影响图鉴。

```mermaid
flowchart TD
    A[用户点击分解藏品] --> B[后端校验 session]
    B --> C[校验藏品是否可分解]
    C --> D[校验用户当前可用库存]
    D --> E[开始数据库事务]
    E --> F[减少 user_inventory 当前库存]
    F --> G[发放 Fgems 或材料]
    G --> H[写入分解记录]
    H --> I[写入库存/资产流水]
    I --> J[提交事务]
    J --> K[前端显示分解成功]
    K --> L[user_collectible_unlocks 不变]
    L --> M[图鉴点亮状态不变]
```

---

# 9. 和 Mint 上链功能的连接流程

Mint 也不应该让图鉴回退。

```mermaid
flowchart TD
    A[用户点击 Mint] --> B[后端校验 session]
    B --> C[校验用户当前拥有该藏品]
    C --> D[锁定或扣除 off-chain 库存]
    D --> E[创建 mint_queue]
    E --> F[链上 Mint 执行]
    F --> G{Mint 是否成功}

    G -->|成功| H[更新 mint 状态为成功]
    H --> I[库存进入已上链/已锁定状态]
    I --> J[user_collectible_unlocks 不变]
    J --> K[图鉴仍然点亮]

    G -->|失败| L[回滚或释放库存锁定]
    L --> M[更新 mint 状态为失败]
    M --> N[user_collectible_unlocks 不变]
```

---

# 10. 图鉴查看流程

用户点击图鉴按钮后，前端只需要请求一个总览接口。

```mermaid
flowchart TD
    A[用户点击图鉴按钮] --> B[打开图鉴弹窗骨架]
    B --> C[GET /api/album/overview]
    C --> D[后端校验 session]
    D --> E[读取所有启用中的 collection_chains]
    E --> F[读取每条链的 collection_chain_nodes]
    F --> G[读取用户 user_collectible_unlocks]
    G --> H[读取用户 user_inventory 当前数量]
    H --> I[读取 user_collection_chain_rewards]
    I --> J[后端聚合每条链状态]

    J --> K[计算总藏品数]
    J --> L[计算已解锁藏品数]
    J --> M[计算总链条数]
    J --> N[计算已完成链条数]
    J --> O[计算可领取奖励链条数]

    K --> P[返回图鉴总览 JSON]
    L --> P
    M --> P
    N --> P
    O --> P

    P --> Q[前端渲染图鉴弹窗]
    Q --> R[已解锁显示宠物头像]
    Q --> S[未解锁显示问号头像]
    Q --> T[完成未领奖显示彩色礼物盒]
    Q --> U[已领奖显示灰色礼物盒]
```

---

# 11. 点击未收集问号的流程

```mermaid
flowchart TD
    A[用户点击问号头像] --> B[前端读取该节点 collectible_id]
    B --> C[展示未收集详情弹窗]
    C --> D[显示问号缩略图]
    D --> E[显示藏品名称]
    E --> F[显示所属进化链]
    F --> G[显示获取方式按钮]

    G --> H[按钮1 去交易市场购买]
    G --> I[按钮2 去开盲盒蛋]

    H --> J[跳转市场页]
    J --> K[自动筛选该 collectible_id]
    K --> L[展示出售中的该藏品]

    I --> M[跳转开蛋页]
    M --> N[推荐可以开出该藏品的蛋]
```

这里建议后端在 `/api/album/overview` 返回每个未解锁节点的获取方式，例如：

```json
{
  "collectibleId": "c002",
  "name": "火恐龙",
  "owned": false,
  "marketsAvailable": true,
  "boxSources": [
    {
      "boxId": "rare_egg",
      "boxName": "稀有蛋"
    }
  ]
}
```

这样前端点击问号时，不需要再请求很多接口。

---

# 12. 图鉴链条奖励领取流程

图鉴奖励应该根据 `user_collectible_unlocks` 判断，而不是根据 `user_inventory` 判断。

```mermaid
flowchart TD
    A[用户点击链条末尾礼物盒] --> B[POST /api/album/claim-chain-reward]
    B --> C[后端校验 session]
    C --> D[校验 chain_id 是否存在且启用]
    D --> E[读取 collection_chain_nodes]
    E --> F[读取用户 user_collectible_unlocks]
    F --> G{用户是否解锁该链全部节点}

    G -->|否| H[返回未完成，不能领取]
    G -->|是| I[检查 user_collection_chain_rewards]

    I --> J{是否已经领取过}
    J -->|是| K[返回已领取]
    J -->|否| L[开始数据库事务]

    L --> M[插入 user_collection_chain_rewards]
    M --> N[发放奖励]
    N --> O{奖励类型}
    O -->|Fgems| P[增加用户 Fgems]
    O -->|开蛋次数| Q[增加用户免费开蛋次数]
    O -->|藏品| R[增加 user_inventory]
    R --> S[UPSERT user_collectible_unlocks]
    O -->|头像框/徽章| T[写入用户权益表]

    P --> U[写入 reward_ledger 奖励流水]
    Q --> U
    S --> U
    T --> U

    U --> V[提交事务]
    V --> W[返回领取成功]
    W --> X[前端播放奖励弹窗]
    X --> Y[礼物盒变成已领取状态]
```

必须加唯一约束：

```sql
unique(user_id, chain_id)
```

防止用户重复领取同一条图鉴链奖励。

---

# 13. 图鉴链条状态机

```mermaid
stateDiagram-v2
    [*] --> Locked

    Locked --> Collecting: 用户解锁该链部分藏品
    Collecting --> Claimable: 用户解锁该链全部藏品
    Claimable --> Claimed: 用户领取链条奖励

    Claimed --> Claimed: 用户出售藏品
    Claimed --> Claimed: 用户分解藏品
    Claimed --> Claimed: 用户合成消耗藏品
    Claimed --> Claimed: 用户 Mint 上链

    Collecting --> Collecting: 用户出售/分解已解锁藏品
    Claimable --> Claimable: 用户出售/分解已解锁藏品
```

这个状态机表达的核心是：

```text
图鉴状态只会前进，不会因为出售、分解、合成消耗而回退。
```

---

# 14. 推荐接口设计

## 14.1 获取图鉴总览

```http
GET /api/album/overview
```

作用：

```text
返回所有图鉴链条、用户解锁状态、当前拥有数量、奖励领取状态。
```

后端返回结构建议：

```json
{
  "summary": {
    "totalCollectibles": 100,
    "unlockedCollectibles": 36,
    "totalChains": 20,
    "completedChains": 3,
    "claimableChains": 1
  },
  "chains": [
    {
      "chainId": "fire_001",
      "chainName": "火焰初心者链",
      "status": "claimable",
      "rewardStatus": "claimable",
      "progress": {
        "unlocked": 3,
        "total": 3
      },
      "reward": {
        "type": "fgems",
        "amount": 500
      },
      "nodes": [
        {
          "collectibleId": "c001",
          "name": "小火龙",
          "unlocked": true,
          "currentQuantity": 2,
          "thumbnailUrl": "/images/charmander.png",
          "nodeOrder": 1
        },
        {
          "collectibleId": "c002",
          "name": "火恐龙",
          "unlocked": true,
          "currentQuantity": 0,
          "thumbnailUrl": "/images/charmeleon.png",
          "nodeOrder": 2
        },
        {
          "collectibleId": "c003",
          "name": "喷火龙",
          "unlocked": true,
          "currentQuantity": 1,
          "thumbnailUrl": "/images/charizard.png",
          "nodeOrder": 3
        }
      ]
    }
  ]
}
```

注意这里：

```json
"unlocked": true,
"currentQuantity": 0
```

表示：

```text
图鉴已经点亮，但是用户当前仓库没有这个藏品。
```

这就是“永久解锁”和“当前库存”的区别。

---

## 14.2 领取图鉴链奖励

```http
POST /api/album/claim-chain-reward
```

请求：

```json
{
  "chainId": "fire_001"
}
```

后端校验：

| 校验项          | 说明 |
| ------------ | -- |
| 用户是否登录       | 必须 |
| chainId 是否存在 | 必须 |
| chain 是否启用   | 必须 |
| 用户是否解锁该链所有节点 | 必须 |
| 是否已经领取过      | 必须 |
| 奖励配置是否有效     | 必须 |
| 是否成功写入奖励流水   | 必须 |

返回：

```json
{
  "success": true,
  "reward": {
    "type": "fgems",
    "amount": 500
  }
}
```

---

# 15. 不建议开放的接口

不建议开放这种接口给前端：

```http
POST /api/album/unlock
```

原因：

```text
前端不能直接告诉后端“我要解锁某个图鉴”。
```

否则用户可能伪造请求，直接解锁稀有藏品。

正确方式是：

```text
开盒、购买、合成、活动奖励、后台发放这些业务成功后，
由后端在同一个事务里自动 upsert user_collectible_unlocks。
```

---

# 16. 统一发放藏品函数设计

为了避免每个业务单独写一遍图鉴逻辑，建议后端封装一个统一方法：

```text
grant_collectible(user_id, collectible_id, quantity, source, source_event_id)
```

它负责：

```text
1. 增加用户当前库存
2. upsert 图鉴解锁记录
3. 写入库存流水
4. 返回是否首次解锁
```

伪 SQL：

```sql
-- 1. 增加当前库存
insert into user_inventory (
  user_id,
  collectible_id,
  quantity_available,
  quantity_locked,
  updated_at
)
values (
  :user_id,
  :collectible_id,
  :quantity,
  0,
  now()
)
on conflict (user_id, collectible_id)
do update set
  quantity_available = user_inventory.quantity_available + excluded.quantity_available,
  updated_at = now();

-- 2. 图鉴永久解锁
insert into user_collectible_unlocks (
  user_id,
  collectible_id,
  first_unlocked_at,
  first_source,
  first_source_event_id
)
values (
  :user_id,
  :collectible_id,
  now(),
  :source,
  :source_event_id
)
on conflict (user_id, collectible_id)
do nothing;
```

---

# 17. 来源 source 建议

`user_collectible_unlocks.first_source` 建议使用枚举。

| source         | 含义      |
| -------------- | ------- |
| `box_open`     | 开盲盒获得   |
| `market_buy`   | 市场购买获得  |
| `evolution`    | 合成/进化获得 |
| `event_reward` | 活动奖励获得  |
| `album_reward` | 图鉴奖励获得  |
| `admin_grant`  | 后台发放    |
| `airdrop`      | 空投获得    |

`first_source_event_id` 用来追踪来源记录，例如：

| source         | source_event_id 对应       |
| -------------- | ------------------------ |
| `box_open`     | `box_open_records.id`    |
| `market_buy`   | `market_trades.id`       |
| `evolution`    | `evolution_records.id`   |
| `event_reward` | `event_reward_claims.id` |
| `admin_grant`  | `admin_grant_records.id` |

---

# 18. 最终业务闭环总结

完整图鉴系统应该是：

```text
用户获得藏品
→ 当前仓库增加
→ 图鉴永久解锁表 upsert
→ 用户打开图鉴
→ 后端根据图鉴解锁表计算收集进度
→ 前端展示头像 / 问号 / 礼物盒
→ 用户点击问号
→ 引导去市场购买或开蛋
→ 用户补齐整条链
→ 礼物盒出现
→ 用户领取链条奖励
→ 奖励写入流水
→ 礼物盒变成已领取
```

最重要的设计原则是：

```text
user_inventory 负责“当前还有多少”
user_collectible_unlocks 负责“曾经收集过哪些”
user_collection_chain_rewards 负责“哪些图鉴链奖励已经领取”
```

这样你的图鉴功能才能和开盲盒、交易市场、合成、分解、Mint、奖励系统稳定连接，不会因为用户卖掉或消耗藏品导致图鉴反复熄灭。
