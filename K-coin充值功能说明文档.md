# K-coin 充值功能说明文档

本文只根据当前项目代码整理，重点说明功能本身怎么用、系统怎么处理、什么情况下到账，以及当前代码里能确认的范围。

## 一、这个功能是做什么的

K-coin 充值功能用于把 Telegram Stars 充值成项目里的 K-coin。

当前代码里明确写着兑换关系是：

- 1 Star = 1 K-coin
- 用户支付多少 Stars，就到账多少 K-coin
- K-coin 到账必须由服务端确认，前端不能自己给用户加余额

这个充值功能目前不是单独放在一个充值页面里，而是作为一个全局弹窗使用。只要页面在主框架里，就可以通过顶部资产栏或者业务流程打开这个弹窗。

## 二、用户从哪里进入充值

当前代码能确认有三个入口。

### 1. 顶部 K-coin 资产栏

用户点击顶部资产栏里的 K-coin 数字，会打开 K-coin 充值弹窗。

这个入口是普通充值入口。用户不一定是余额不足，只是想主动充值。

### 2. 开盒时 K-coin 不足

用户开盒时，如果当前 K-coin 不够支付本次开盒，页面会打开同一个充值弹窗。

这时弹窗会显示：

- 本次开盒需要多少 K-coin
- 用户当前有多少 K-coin
- 还差多少 K-coin
- 推荐用户直接补足差额

充值到账后，系统会刷新资产，然后继续刚才那次开盒请求。

### 3. 购买或续费月卡时 K-coin 不足

用户购买或续费月卡时，如果 K-coin 不够，页面也会打开同一个充值弹窗。

这时弹窗会显示本次月卡操作需要的 K-coin、当前余额和差额。充值到账后，系统会刷新资产和月卡状态，然后继续刚才的月卡购买或续费流程。

## 三、弹窗里用户会看到什么

充值弹窗标题是“充值 K-coin”，并且会显示“1 Star = 1 K-coin”。

普通充值时，用户会看到固定充值档位：

- 500 K-coin
- 1,000 K-coin
- 5,000 K-coin
- 10,000 K-coin

如果是开盒或月卡余额不足触发的充值，弹窗最前面会多一个“补足差额”的推荐选项。这个选项的金额就是当前这次操作缺的 K-coin 数量。

举例来说，代码里的测试覆盖了这种情况：本次操作需要 10 K-coin，用户当前只有 1 K-coin，弹窗会显示“补足 9 K-coin”，并把它放在固定档位前面。

## 四、完整充值流程

完整流程是这样的：

1. 用户打开 K-coin 充值弹窗。
2. 用户选择一个充值金额。
3. 前端向后端创建充值订单。
4. 后端创建项目内的 K-coin 充值单，同时创建 Telegram Stars 支付单。
5. 后端向 Telegram 申请 Stars 支付账单。
6. 前端拿到 Telegram 支付账单后，调用 Telegram Mini App 的支付窗口。
7. 用户在 Telegram 支付窗口里完成支付。
8. Telegram 把支付结果通过 webhook 发给后端。
9. 后端记录支付成功信息。
10. 后端把对应数量的 K-coin 写入用户资产流水和余额。
11. 前端查询到服务端已确认到账后，刷新顶部资产栏。
12. 如果这次充值是为了开盒或月卡，系统会继续刚才被余额不足打断的操作。

这套流程里，前端看到“支付返回”还不等于已经到账。真正到账要看服务端和数据库有没有完成入账。

## 五、什么时候算到账

当前代码里，K-coin 到账要同时满足这些条件：

- Telegram 支付成功
- webhook 已经被后端收到
- 后端确认这笔支付属于当前这张 K-coin 充值单
- 支付金额和充值金额一致
- 充值单和 Stars 支付单能互相对上
- 数据库已经把 K-coin 写入资产流水
- 数据库已经把充值单标记为完成

只有这些都完成后，前端才会显示“K-coin 已到账”，并刷新顶部资产栏。

如果用户只是打开了支付窗口，但没有完成支付，K-coin 不会到账。

如果 Telegram 返回支付成功，但后端还没完成确认，前端会显示“支付已返回，等待到账”，并继续查询状态。

## 六、充值状态说明

当前弹窗会按不同情况给用户提示。

### 等待支付

订单已经创建，正在等用户去 Telegram Stars 窗口完成支付。

### 支付窗口已打开

前端已经成功打开 Telegram Stars 支付窗口，用户需要在 Telegram 里完成支付。

### 支付已返回，等待到账

Telegram 支付窗口已经返回支付相关结果，但服务端还没有最终确认到账。这个阶段用户不要重复支付。

### K-coin 已到账

服务端确认充值成功，数据库已经把 K-coin 加到用户资产里。前端会刷新顶部资产栏。

### 充值订单已过期

当前订单没有完成支付，用户需要重新选择充值档位。

### 充值未完成

服务端没有确认本次充值成功，K-coin 不会到账。

### 支付窗口未打开

当前环境没有成功打开 Telegram Stars 支付窗口。代码里提示用户可以重试支付，或者从 Telegram Mini App 内重新尝试。

## 七、后端主要负责什么

后端不是只转发请求，它会做几件关键事情。

### 1. 确认用户登录状态

创建充值单和查询充值状态都要求用户已经登录。用户只能查自己的充值单。

### 2. 检查支付功能是否开放

代码里有支付开关和生产环境检查。如果支付功能被关闭，或者生产环境缺少必要支付配置，后端不会继续创建支付单。

### 3. 检查账号是否允许支付

创建充值单前，后端会走账号风险检查。被限制的账号不能继续创建充值订单。

### 4. 创建充值单和 Stars 支付单

后端会在数据库里创建 K-coin 充值单，也会创建对应的 Telegram Stars 支付单。两张单会互相关联。

### 5. 生成 Telegram 支付账单

后端会调用 Telegram 创建 Stars 支付账单。前端拿到账单链接后，才能打开 Telegram 支付窗口。

### 6. 处理 Telegram 回调

Telegram 会先发支付前检查，再发支付成功消息。后端会记录这些回调，并在支付成功后执行 K-coin 入账。

### 7. 失败后可补偿

项目里有支付重试任务。它会处理已经支付但发货还没完成、发货中断、或可重试失败的支付单。

## 八、数据库里保存了什么

当前代码能确认，K-coin 充值相关数据会落在这些业务记录里：

- K-coin 充值单：记录这次充值属于谁、充多少、当前状态是什么
- Stars 支付单：记录 Telegram Stars 支付对应的业务单
- Stars 支付记录：记录 Telegram 确认成功的支付
- Telegram webhook 记录：记录 Telegram 发来的回调
- 资产流水：记录 K-coin 是怎么进入用户账户的
- 用户余额：给顶部资产栏和业务消费读取当前可用 K-coin

这里最重要的是资产流水和用户余额。充值单完成不只是改一个状态，还会真正写入 K-coin 资产。

## 九、防重复和安全处理

当前代码里能确认这些保护：

- 同一次充值创建请求会被防重复处理，避免重复创建或重复入账。
- 数据库会检查 Stars 数量和 K-coin 数量一致。
- 数据库会检查支付单和充值单是否属于同一个用户。
- 数据库会检查 Telegram 支付凭证有没有被别的订单使用。
- 如果充值已经完成，再次收到相同支付结果时，会按已完成处理，不会重复加 K-coin。
- 普通用户不能直接读写 K-coin 充值单表，代码里只给服务端角色处理。
- 状态查询返回给前端的信息经过整理，不会把 Telegram 原始支付数据直接暴露给前端。

## 十、和开盒、月卡的关系

当前项目里，开盒和月卡都可以消耗 K-coin。

K-coin 充值本身只负责“把 Stars 换成 K-coin”。它不会直接替用户完成开盒或月卡。

不过，当用户因为开盒或月卡余额不足而进入充值时，充值弹窗会保存这次操作的上下文。到账后，前端会刷新资产，并继续执行原来的开盒或月卡操作。

所以用户体验上看起来像是：

- K-coin 不够
- 先补差额
- 到账后继续原操作

但系统内部仍然是两步：先充值 K-coin，再用 K-coin 完成开盒或月卡。

## 十一、当前代码能确认的边界

当前能确认：

- 统一充值入口在资产模块里。
- 顶部 K-coin 资产栏可以主动打开充值弹窗。
- 开盒余额不足会打开同一个充值弹窗。
- 月卡余额不足会打开同一个充值弹窗。
- 普通充值的固定档位是 500、1,000、5,000、10,000。
- 余额不足场景可以显示精确补差额选项。
- 到账必须经过 Telegram 支付成功和服务端确认。
- 到账后会刷新顶部资产栏。
- 开盒和月卡的余额不足流程，会在充值到账后继续原操作。

当前没有在代码里确认到：

- 独立的“充值历史页面”。
- 用户自己随便输入任意充值金额的入口。
- 前端直接修改 K-coin 余额的逻辑。

另外，盒子模块里还能看到早期留下的 K-coin 充值弹窗和封装文件。但当前实际页面调用的是资产模块里的统一充值弹窗。

## 十二、代码依据

本说明主要根据以下代码整理：

- `apps/web/src/shared/layout/AppShell.tsx`
- `apps/web/src/features/assets/components/AssetBar.tsx`
- `apps/web/src/features/assets/components/KcoinTopupProvider.tsx`
- `apps/web/src/features/assets/components/KcoinTopupSheet.tsx`
- `apps/web/src/features/assets/hooks/useKcoinTopupPayment.ts`
- `apps/web/src/features/assets/hooks/useKcoinTopupStatus.ts`
- `apps/web/src/features/assets/kcoinTopup.api.ts`
- `apps/web/src/features/box/pages/BoxPage.tsx`
- `apps/web/src/features/trade/pages/BuyPage.tsx`
- `api/payments/kcoin-topup/create-order.ts`
- `api/payments/kcoin-topup/status.ts`
- `api/telegram/webhook.ts`
- `packages/server/src/payments/telegramStars.ts`
- `packages/server/src/payments/paymentGuards.ts`
- `scripts/retry-failed-payments.ts`
- `api/cron/retry-payments.ts`
- `supabase/migrations/20260605141107_kcoin_open_and_topup.sql`
- `supabase/migrations/20260605142608_kcoin_topup_status.sql`
- `supabase/migrations/20260606113426_kcoin_shortage_topup_for_open_box.sql`
- `supabase/migrations/20260606122709_vip_monthly_kcoin_payment.sql`
- `tests/api/kcoin-topup.test.ts`
- `apps/web/src/features/assets/components/KcoinTopupSheet.test.tsx`

