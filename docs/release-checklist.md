# 上线 Checklist

## 第五阶段支付和链上上线前检查

- [ ] 生产环境 `DEV_GACHA_PAYMENT_MODE=false`。
- [ ] Vercel Production 未配置 `DEV_GACHA_PAYMENT_MODE=true`。
- [ ] `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`、`TON_MINTER_PRIVATE_KEY` 仅存在于服务端环境变量。
- [ ] 已支付但未发货的订单仍允许后台补发；关闭新支付不影响历史订单查询和补偿。
- [ ] 后台“监控”页可见支付失败率、发货失败率、webhook 延迟和 Mint 卡住数量。
