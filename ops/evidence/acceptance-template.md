# 真实环境验收证据模板

每个场景复制一份，所有字段必填；截图和日志只保存引用，不提交敏感值。

```text
场景：
环境：test / production-smoke
Git commit：
Migration：20260718000100 / 20260718000200 / 20260718000300
设备、Telegram 版本、浅色/深色：
开始时间（UTC）：
request_id：
operation_id：
幂等键指纹（不可记录原值）：
账本前值 / 后值：
库存前值 / reservation / 后值：
支付订单 / Telegram charge id（脱敏）：
Mint id / tx hash / NFT address：
预期：
实际：
服务端日志引用：
截图引用：
结论：PASS / FAIL
验收人：
```

最小场景集：Telegram 登录/过期/替换/banned/initData 边界；210 模板与三奖池；开盒概率/保底；账本与 reservation；进化/分解；三档远征；转盘；市场 FIFO；任务/邀请/图鉴/VIP；Stars 创建、重复 webhook、付款未交付、退款与恢复；TON Connect；Mint 成功/失败/取消/超时/重放/恢复；重复点击、网络重试、乱序和多端并发；真机安全区、BackButton、浅深主题及即时反馈。
