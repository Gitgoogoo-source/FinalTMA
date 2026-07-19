import type { RecoverableRouteId } from "@pokepets/api-contracts";

const labels: Partial<Record<RecoverableRouteId, string>> = {
  "album.claim": "正在领取图鉴奖励",
  "expedition.claim": "正在领取远征奖励",
  "expedition.create": "正在创建远征",
  "gacha.open": "正在开启盲盒",
  "inventory.decompose": "正在分解藏品",
  "inventory.evolve": "正在进化藏品",
  "market.cancel_listing": "正在取消挂单",
  "market.create_listing": "正在创建挂单",
  "market.purchase": "正在确认市场购买",
  "mint.cancel": "正在取消 Mint",
  "mint.reserve": "正在锁定藏品并签发 Mint 凭证",
  "mint.submit": "正在等待链上确认",
  "referral.bind": "正在确认邀请关系",
  "referral.share_event": "正在记录邀请动作",
  "tasks.check_in": "正在领取签到奖励",
  "tasks.claim": "正在领取任务奖励",
  "topup.create_order": "正在创建 Telegram Stars 订单",
  "vip.claim_fgems": "正在领取 VIP F-gems",
  "vip.claim_free_box": "正在领取 VIP 盲盒",
  "vip.create_order": "正在创建 VIP Stars 订单",
  "wallet.disconnect": "正在断开钱包",
  "wallet.verify": "正在验证 TON 钱包",
  "wheel.spin": "正在转动幸运转盘",
};

export function operationLabel(routeId: RecoverableRouteId): string {
  return labels[routeId] ?? "正在确认操作";
}
