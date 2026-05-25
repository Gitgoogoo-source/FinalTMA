---
description: "通用 Telegram Mini App 开发规则：适用于 AI vibe coding / Cursor / Codex / Claude Code / Windsurf"
globs:
  - "**/*"
alwaysApply: true
---

# Universal Rules for Telegram Mini App Development

本规则适用于开发 Telegram Mini App、小游戏、任务系统、交易系统、钱包连接、虚拟资产、支付和后台运营系统。
目标是让 AI 编码时遵守工程原则，减少幻觉、错误架构、不安全代码、重复造轮子和绕过业务事务。

---

## 0. 基本工作原则

在修改代码前，必须先理解当前项目，而不是直接生成代码。

每次开始开发前必须先检查：

1. 当前项目目录结构。
2. 当前技术栈和 package 管理器。
3. 当前已有页面、API、数据库、类型定义、工具函数。
4. 当前命名风格、错误处理风格、鉴权方式、请求封装方式。
5. 当前已有业务模块，不要重复实现相同功能。
6. 当前数据库 schema、表、字段、索引、约束、RLS、RPC。
7. 当前测试方式和脚本。

禁止：

- 不检查现有代码就直接创建新文件。
- 不确认表 / RPC / API 是否存在就直接调用。
- 为了完成任务而重复造一套架构。
- 用“假设存在某函数 / 某表 / 某路径”的方式写代码。
- 在不确定时编造实现细节。
- 只写 happy path，不处理错误、空状态、loading、鉴权失败、并发、重复请求。

---

## 1. Telegram Mini App 特有规则

### 1.1 Telegram initData

- 前端可以读取 Telegram WebApp `initData`，但不能信任前端解析结果。
- 前端的 `initDataUnsafe` 只可用于临时 UI 展示，不可作为后端身份依据。
- 后端必须验证 `initData` 签名。
- 后端验证通过后，才能创建或刷新应用 session。
- 后端 API 必须从已验证 session 中获取 `user_id`。
- 禁止信任前端 body/query 中传入的 `user_id`、`telegram_user_id`、`wallet_address`、`role`、`is_admin`。

### 1.2 Session

- 推荐使用后端签发的短期 session。
- session token 应存 HttpOnly Secure Cookie，或使用安全 Bearer token 方案。
- 数据库只存 token hash，不存明文 token。
- 每个需要用户身份的 API 都必须校验 session。
- 用户状态为 banned / restricted / deleted 时，写操作必须拒绝。
- session 过期、撤销、用户不存在时，返回稳定错误码。

### 1.3 Telegram UI 能力

- Telegram Back Button、Main Button、主题色、viewport、haptic feedback 只能做 UI 辅助。
- 不要把 Telegram 客户端状态当成业务真相。
- 分享、复制链接、打开弹窗等行为不能直接发奖励，必须由后端判断是否有效。

---

## 2. 前端架构规则

### 2.1 前端职责

前端只负责：

- 展示页面。
- 发起 API 请求。
- 展示 loading / empty / error / success 状态。
- 展示 Toast、Modal、Sheet、Result。
- 做基础表单校验。
- 做 UI 状态管理。
- 根据后端返回结果刷新页面。

前端禁止：

- 计算真实中奖结果。
- 计算真实余额。
- 发放奖励。
- 修改库存。
- 判断任务真实完成。
- 判断支付成功。
- 判断链上交易最终状态。
- 伪造任务进度。
- 直接写核心数据库表。
- 保存私钥、服务端密钥、Bot Token、service role key。

### 2.2 状态管理

- 服务端数据使用 query/cache 工具管理，例如 TanStack Query。
- 本地 UI 状态使用轻量状态管理，例如 Zustand、React state。
- 不要把服务端资产余额、库存、订单状态长期存在本地 store 作为真相。
- mutation 成功后必须 invalidate 相关 query。
- 失败时必须回滚 optimistic UI 或重新拉取服务端数据。

### 2.3 API Client

- 所有 API 路径集中管理，不要在组件里散落硬编码 URL。
- 请求封装应统一处理：
  - base URL
  - credentials / cookie
  - Authorization
  - JSON parse
  - 错误码
  - 超时
  - 网络错误
- API response 必须经过类型校验或 normalizer。
- 前端组件不要直接依赖数据库字段结构。
- 数据库 snake_case 与前端 camelCase 的转换应集中在 API client 或 normalizer。

### 2.4 组件

组件必须按职责拆分：

- Page：页面组装和请求调度。
- Container：业务模块容器。
- Component：纯展示组件。
- Hook：请求和状态封装。
- API：请求封装。
- Types / Schema：类型和校验。

组件禁止：

- 在展示组件中直接调用复杂业务 API。
- 在组件里硬编码奖励金额、概率、手续费、分红比例。
- 在组件里写复杂业务判断。
- 在组件里直接操作数据库 SDK 写核心表。

---

## 3. 后端 API 规则

### 3.1 API 职责

后端 API 负责：

- 验证 session。
- 校验入参。
- 限流。
- 权限判断。
- 调用数据库 RPC / service。
- 处理第三方 webhook。
- 返回稳定响应格式。
- 映射稳定错误码。

后端 API 不应该：

- 把复杂业务事务拆成多次非原子数据库写入。
- 在 API 层直接散落写多张核心业务表。
- 信任前端 user_id。
- 直接返回数据库内部异常。
- 直接暴露敏感字段。
- 在 webhook 未做幂等时发放资产。

### 3.2 API 基本要求

每个 API 必须包含：

- method 限制。
- session 校验，公开接口除外。
- 入参 schema 校验。
- 统一错误处理。
- 稳定业务错误码。
- rate limit 或风控策略。
- request id / trace id。
- 日志上下文。
- 对写操作使用 idempotency key。
- 对核心业务写操作调用数据库事务 / RPC。

### 3.3 禁止信任的前端字段

以下字段如果来自前端，只能作为请求意图，不能作为事实：

- `user_id`
- `telegram_user_id`
- `wallet_address`
- `role`
- `is_admin`
- `balance`
- `price_after_fee`
- `reward_amount`
- `task_completed`
- `payment_success`
- `nft_owner`
- `rarity`
- `drop_result`
- `commission_amount`
- `invitee_user_id`
- `inviter_user_id`

所有事实必须由后端、数据库、Telegram webhook、支付系统、链上查询或已验证签名决定。

---

## 4. 数据库设计规则

### 4.1 数据库是真实业务核心

核心业务状态必须以后端和数据库为准：

- 资产余额。
- 资产流水。
- 抽卡结果。
- 库存归属。
- 交易挂单。
- 支付状态。
- 任务进度。
- 邀请关系。
- 签到状态。
- 奖励领取。
- 链上同步状态。

前端不能成为业务真相来源。

### 4.2 表设计

所有核心表必须有：

- 主键。
- 创建时间。
- 必要的更新时间。
- 状态字段。
- 必要的唯一约束。
- 必要的外键。
- 必要的索引。
- 审计字段或 metadata。
- 明确的数据所有者，例如 `user_id`。
- 明确的生命周期状态。

不要只靠应用代码防重复，必须用数据库唯一约束兜底。

### 4.3 命名

推荐：

- 数据库：`snake_case`。
- 前端：`camelCase`。
- 常量枚举：`UPPER_SNAKE_CASE`。
- API 路径：kebab-case。
- RPC 参数：`p_` 前缀。
- 状态值：统一小写字符串或统一大写枚举，不要混用。

如果现有项目已有命名风格，必须优先沿用现有风格。

### 4.4 Migration

- 所有 schema 变更必须通过 migration。
- 不要手动在生产数据库做不可追踪 DDL。
- migration 必须可重复审查。
- DDL 变更前检查是否已有同名表、字段、索引、函数。
- 数据修复和结构变更尽量拆开。
- 高风险 migration 要写 rollback 方案或修复方案。
- 不要在 migration 中硬编码生产环境生成 ID，除非明确是稳定 code。
- seed 数据要使用稳定 code / slug 做 upsert。

---

## 5. RLS 和权限规则

### 5.1 默认开启 RLS

所有用户相关表必须启用 RLS。

默认策略：

- 用户只能读取自己的数据。
- 用户不能直接写核心业务表。
- 公开配置表可以只读。
- 管理员表仅管理员可读写。
- 风控、审计、幂等表前端不可访问。
- 资产流水用户只能读取自己的流水，不能写入。

### 5.2 不要用放宽 RLS 解决业务问题

禁止：

- 为了让功能跑通而允许 authenticated 任意读写。
- 允许用户 update 自己的余额、库存、任务进度。
- 允许用户 insert 自己的奖励领取记录。
- 允许用户写自己的邀请奖励、分红记录。
- 在 RLS 中暴露敏感风控字段。

正确做法：

- 写操作走后端 API。
- API 使用 service role 或安全 RPC。
- RPC 内部检查当前用户和权限。
- RLS 保持最小权限。

### 5.3 Security Definer

使用 `SECURITY DEFINER` 的函数必须：

- 设置固定 `search_path`。
- 检查调用者权限或传入的 session user。
- 不返回敏感字段。
- 只做必要权限提升。
- 避免动态 SQL，必须使用时要严格 quote。
- 错误信息不要泄露内部结构。

---

## 6. 资产与账本规则

### 6.1 所有资产变化必须写 ledger

任何虚拟资产变化都必须写不可变流水：

- 充值。
- 开盒返利。
- 签到奖励。
- 任务奖励。
- 邀请奖励。
- 分红。
- 购买扣款。
- 出售到账。
- 手续费。
- 升级消耗。
- 合成消耗。
- 分解奖励。
- 退款。
- 管理员调整。
- 风控冻结 / 解冻。

禁止只更新余额表。

### 6.2 余额表只是快照

- `user_balances` 只能作为查询优化快照。
- ledger 才是资产变化的解释来源。
- 每次资产变化必须同事务写 ledger 和余额快照。
- ledger 不允许 update/delete。
- 纠错使用 reversal / adjustment。

### 6.3 Ledger 必备字段

ledger 至少应包含：

- `id`
- `user_id`
- `currency_code`
- `entry_type`
- `amount`
- `available_before`
- `available_after`
- `locked_before`
- `locked_after`
- `source_type`
- `source_id`
- `idempotency_key`
- `metadata`
- `created_at`

### 6.4 幂等

所有资产变更必须有幂等键：

- 支付 webhook：使用支付系统唯一 ID。
- 用户按钮请求：使用客户端 idempotency key + user_id + action。
- 业务事件：使用 source_type + source_id。
- 奖励领取：使用 user_id + reward_type + period_key。
- 邀请奖励：使用 referral_id + reward_role。
- 分红：使用 referral_id + source_order_id。

---

## 7. 支付规则

### 7.1 Telegram Stars

- Telegram Stars 支付必须通过官方支付流程。
- 不能仅凭前端支付按钮状态发货。
- 不能仅凭创建 invoice 发货。
- 不能仅凭 pre-checkout 发货。
- 必须收到并验证 successful payment webhook 后再发放资产。
- 支付 webhook 必须先落库，再处理。
- 支付 webhook 必须幂等。
- 订单状态必须可追踪：created / pending / paid / fulfilled / failed / refunded。
- 支付成功和业务发货应在数据库中可对账。

### 7.2 退款和争议

- 需要记录退款、争议、撤销。
- 若有退款风险，相关资产应支持锁定、冻结或补偿策略。
- 不要在没有风控策略时允许高价值资产立即交易或提现。

---

## 8. 抽卡 / 盲盒 / 随机奖励规则

### 8.1 抽卡结果

- 抽卡结果必须由后端生成。
- 前端不能传入抽卡结果。
- 前端不能控制随机种子。
- 奖励池必须有版本。
- 抽卡结果必须记录使用的奖励池版本。
- 概率、保底、库存必须由数据库事务控制。

### 8.2 保底

- 保底状态必须按用户和盲盒隔离。
- 保底计数必须在事务中更新。
- 达到保底时必须强制命中配置奖励。
- 命中保底后必须按规则重置。
- webhook 重放不能重复增加保底或重复发放奖励。

### 8.3 奖励池

- 概率配置不要硬编码在前端。
- 运营修改概率必须生成新版本。
- 历史订单必须可追溯当时使用的池版本。
- 已下架、未开始、已结束、售罄的池不能继续抽。

---

## 9. 交易市场规则

### 9.1 挂单

- 挂单时必须锁定库存。
- 被锁定的资产不能再次挂单、升级、合成、分解、转移、mint。
- 挂单价格、手续费、预计到账由后端返回。
- 前端显示的预计到账仅供展示，以成交时后端计算为准。

### 9.2 购买

购买必须在一个事务中完成：

1. 锁定挂单。
2. 校验挂单状态。
3. 校验买家余额。
4. 扣买家余额并写 ledger。
5. 给卖家入账并写 ledger。
6. 记录平台手续费并写 ledger。
7. 转移资产归属。
8. 更新挂单状态。
9. 写市场订单和事件。

并发购买同一挂单，只能一个成功。

### 9.3 手续费

- 手续费配置必须后端控制。
- 成交时要保存手续费快照。
- 不要让前端传入最终手续费。
- 平台收入必须可对账。

---

## 10. 任务 / 邀请 / 签到 / 分红规则

### 10.1 任务进度

- 任务进度只能由真实业务事件推动。
- 前端不能提交“我完成了任务”。
- 任务进度更新必须幂等。
- 同一 source event 不能重复增加进度。
- 任务周期必须明确：once / daily / weekly / campaign。
- 任务状态必须明确：in_progress / completed / claimed / expired。

### 10.2 任务奖励领取

- 未完成任务不能领取。
- 已领取任务不能重复领取。
- 领取时必须锁定进度行。
- 领取记录必须有唯一约束。
- 领取成功必须写 ledger。
- 并发领取只能成功一次。

### 10.3 签到

- 每天只能签到一次。
- 连续签到规则必须由后端判断。
- 断签规则必须明确。
- 每日奖励来自后端配置。
- 签到成功必须写签到记录和 ledger。
- 重复点击只能返回已签到或幂等结果，不能重复发奖励。

### 10.4 邀请

- 不能自己邀请自己。
- 一个用户只能绑定一个邀请人。
- 已绑定关系不可随意修改。
- 不能做多级返佣，除非明确设计并合规审查。
- 邀请奖励必须由真实业务事件触发，例如被邀请人首次有效开盒。
- 邀请链接 payload 不应直接暴露内部 UUID。
- 邀请刷号、重复绑定、异常设备、异常 IP 应记录风险事件。

### 10.5 分红

- 分红来源必须是真实支付或真实业务事件。
- 分红比例由后端配置。
- 分红金额由后端计算。
- 同一 source event 只能生成一次分红。
- 如果有“待领取 / 已领取”，pending 记录领取时才写 ledger。
- 领取分红必须幂等和并发安全。

---

## 11. TON 钱包和链上 NFT 规则

### 11.1 钱包连接

- 只能保存公开地址。
- 不能保存私钥。
- 不能要求用户输入助记词。
- 钱包地址必须通过 TON Connect 或签名证明验证。
- 前端显示的钱包连接状态不能作为后端信任来源。
- 后端必须校验 proof / signature / chain state。

### 11.2 NFT Mint

- Mint 请求必须后端创建队列。
- Mint 前必须锁定对应 off-chain 资产。
- Mint 成功后绑定链上 NFT 地址。
- Mint 失败要支持重试、回滚或人工处理。
- 同一资产不能重复 mint。
- 链上状态同步必须处理延迟、失败、重复回调、链上重组等情况。

### 11.3 链上同步

- 链上 NFT 归属以链上查询为准。
- 同步结果要落库。
- 不能仅凭前端钱包返回结果更新资产归属。
- 转出、转入、burn、mint 都要有状态记录。

---

## 12. 后台运营规则

后台配置必须可审计：

- 盲盒上下架。
- 奖励池版本。
- 概率配置。
- 任务配置。
- 签到奖励。
- 邀请奖励。
- 分红比例。
- 手续费。
- 活动 banner。
- 用户封禁 / 解封。
- 资产调整。
- 风控处理。

每个后台写操作必须记录：

- 操作人。
- 操作时间。
- 操作类型。
- 目标表 / 目标 ID。
- before state。
- after state。
- 操作原因。
- request id / IP hash / user agent。

---

## 13. 错误处理规则

### 13.1 稳定错误码

所有业务错误必须使用稳定错误码，例如：

- `AUTH_REQUIRED`
- `SESSION_EXPIRED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`
- `INSUFFICIENT_BALANCE`
- `ITEM_NOT_FOUND`
- `ITEM_ALREADY_LOCKED`
- `ORDER_NOT_FOUND`
- `PAYMENT_NOT_CONFIRMED`
- `TASK_NOT_COMPLETED`
- `TASK_ALREADY_CLAIMED`
- `SIGNIN_ALREADY_CLAIMED`
- `REFERRAL_SELF_NOT_ALLOWED`
- `REFERRAL_ALREADY_BOUND`
- `RATE_LIMITED`
- `RISK_REJECTED`
- `INTERNAL_ERROR`

### 13.2 不要泄露内部错误

前端可展示：

- 简短用户可理解文案。
- 稳定错误码。
- request id。

前端不可展示：

- SQL 语句。
- service role 错误。
- 私密配置。
- webhook 原始密钥。
- 内部堆栈。
- 风控细节。

---

## 14. 安全规则

禁止：

- 把 Bot Token、service role key、private key 写入前端。
- 把密钥提交到 Git。
- 在日志里打印完整 token、initData、Authorization、cookie、私钥。
- 使用 `eval`、不安全动态 SQL。
- 关闭 RLS 来解决问题。
- 宽泛 CORS 允许携带凭证且无校验。
- 对 webhook 不校验来源和签名。
- 上传文件不校验类型和大小。
- 直接信任客户端价格、奖励、余额、任务进度。

必须：

- 环境变量区分前端公开变量和后端私密变量。
- 所有 webhook 做幂等。
- 所有写操作做限流。
- 高风险操作写审计。
- 异常行为写风控事件。
- 生产环境错误不暴露内部堆栈。

---

## 15. 并发和幂等规则

所有以下操作必须幂等：

- 登录 / 创建用户。
- 创建订单。
- 支付 webhook。
- 发放抽卡结果。
- 签到。
- 领取任务奖励。
- 绑定邀请关系。
- 首次邀请奖励。
- 生成分红。
- 领取分红。
- 市场购买。
- 创建挂单。
- 下架。
- 升级。
- 合成。
- 分解。
- Mint 请求。
- 链上同步。

并发控制方式：

- 唯一约束。
- `FOR UPDATE`。
- 事务。
- 幂等 key 表。
- ledger idempotency key。
- source_type + source_id 唯一业务键。

不要只依赖前端按钮 disabled。

---

## 16. 测试规则

每个核心模块必须有测试。

### 必测类型

- 单元测试。
- API 测试。
- 数据库 RPC 测试。
- RLS 测试。
- 并发测试。
- 幂等测试。
- Ledger 对账测试。
- 前端交互测试。
- Webhook 重放测试。
- 权限越权测试。

### 必测场景

- 未登录访问。
- 伪造 user_id。
- 重复请求。
- 并发请求。
- 余额不足。
- 资产已锁定。
- 重复领取。
- 重复支付 webhook。
- 自邀请。
- 重复绑定邀请关系。
- RLS 读取他人数据。
- 前端直接写核心表失败。
- ledger 和余额不一致检测。

---

## 17. AI 编码输出规则

### 17.1 写代码前必须说明

在动手写代码前，先列出：

1. 要修改哪些文件。
2. 为什么修改这些文件。
3. 复用哪些现有工具、schema、API、RPC、表。
4. 是否需要 migration。
5. 是否影响已有功能。
6. 需要新增哪些测试。
7. 风险点是什么。

### 17.2 写代码时必须

- 小步修改。
- 优先复用现有模式。
- 保持类型安全。
- 保持错误处理完整。
- 保持命名一致。
- 保持事务边界清晰。
- 保持前后端字段映射清晰。
- 为复杂逻辑添加必要注释。
- 不使用大范围 `any` 逃避类型问题。
- 不删除现有测试。
- 不降低安全策略。

### 17.3 写完代码后必须说明

1. 改了哪些文件。
2. 每个文件改了什么。
3. 如何验证。
4. 需要运行哪些命令。
5. 还有哪些风险或未完成项。

### 17.4 必须建议运行

根据项目实际脚本选择：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build
```

如果项目没有这些脚本，不要编造已经运行成功；应说明“请使用项目实际脚本替代”。

---

## 18. 禁止清单

AI 绝对不要做以下事情：

- 不读项目就写代码。
- 不确认路径就 import。
- 编造不存在的文件、表、字段、RPC。
- 重复创建已有业务模块。
- 把业务真相放在前端。
- 让前端直接写余额、库存、任务、奖励、分红。
- 让前端传 user_id 决定操作对象。
- 不写 ledger 就发奖励。
- 不做 idempotency 就处理支付或奖励。
- 不做 RLS 就创建用户数据表。
- 为了通过类型检查使用大量 `any`。
- 吞掉错误不返回稳定错误码。
- 把密钥写到前端或仓库。
- 忽略 webhook 重放。
- 忽略并发。
- 忽略测试。
- 声称完成但没有验收标准。

---

## 19. 完成定义

一个 Telegram Mini App 功能只有满足以下条件，才算完成：

- 前端页面可用。
- API 鉴权、校验、错误处理完整。
- 核心业务写入由数据库事务完成。
- 资产变化写入 ledger。
- RLS 和权限正确。
- 幂等和并发安全。
- 风控和审计有记录点。
- 空状态、loading、error、success 都处理。
- 测试覆盖主要正常和异常路径。
- 类型检查通过。
- 构建通过。
- 不破坏已有功能。
