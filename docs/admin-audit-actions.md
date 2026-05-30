# Admin Audit Actions

本文档记录当前已经接入 `api.admin_write_audit_log` 的后台写操作 action 常量，避免同义 action 混用。

代码常量源：`packages/server/src/security/auditLog.ts` 的 `ADMIN_AUDIT_ACTIONS`。

## 命名规则

- 使用小写 snake_case。
- 使用 `domain.verb_target` 或现有已落库的稳定 action。
- 新增 action 前先检查本文件和 `ADMIN_AUDIT_ACTIONS`，不要为同一动作新增近义词。
- action 一旦写入审计日志，不要直接重命名历史值；如确实要调整，需要通过新增 migration 兼容旧值。

## 当前 Action

| 常量                      | action                      | 目标                |
| ------------------------- | --------------------------- | ------------------- |
| `adminCreateUser`         | `admin.create_user`         | 创建管理员          |
| `adminUpdateStatus`       | `admin.update_status`       | 修改管理员状态      |
| `adminGrantRole`          | `admin.grant_role`          | 授予管理员角色      |
| `adminRevokeRole`         | `admin.revoke_role`         | 移除管理员角色      |
| `assetCompensate`         | `asset.compensate`          | 后台资产补偿        |
| `featureFlagUpdate`       | `feature_flag.update`       | 修改功能开关        |
| `gachaDropPoolPublish`    | `gacha.drop_pool.publish`   | 发布概率池版本      |
| `inventoryLockRelease`    | `inventory.lock.release`    | 释放库存锁          |
| `mintRetry`               | `mint.retry`                | 重试 Mint 队列      |
| `paymentFulfillmentRetry` | `payment.fulfillment.retry` | 重试支付发货        |
| `paymentRefundRequest`    | `payment.refund.request`    | 发起 Stars 退款请求 |
| `userBan`                 | `user.ban`                  | 封禁或限制用户      |

## 写接口要求

后台写接口必须通过 `callAdminWriteRpc` 调用 `api` schema 下的 admin 写 RPC。RPC 内部必须调用 `api.admin_write_audit_log`，并在响应中返回非空 `audit_log_id`。

API 层不得直接写核心运营表，也不得在缺少 `audit_log_id` 时返回成功。
