import type { RecoverableRouteId } from "@pokepets/api-contracts/app-client";

const labels: Partial<Record<RecoverableRouteId, string>> = {
  "album.claim": "正在领取图鉴奖励",
  "expedition.claim": "正在领取远征奖励",
  "expedition.create": "正在创建远征",
  "gacha.open": "正在开启盲盒",
  "inventory.decompose": "分解仪式",
  "inventory.evolve": "正在进化藏品",
  "market.cancel_template_listings": "正在全部下架",
  "market.create_listing": "正在创建挂单",
  "market.purchase": "正在确认市场购买",
  "referral.bind": "正在确认邀请关系",
  "tasks.check_in": "正在领取签到奖励",
  "tasks.claim": "正在领取任务奖励",
  "topup.create_order": "正在创建 Telegram Stars 订单",
  "topup.cancel_order": "正在取消未付款订单",
  "topup.fail_order": "正在确认充值失败结果",
  "vip.claim_fgems": "正在领取 VIP F-gems",
  "vip.claim_free_box": "正在领取 VIP 盲盒",
  "vip.cancel_order": "正在取消未付款月卡订单",
  "vip.create_order": "正在创建 VIP Stars 订单",
  "wheel.spin": "正在转动幸运转盘",
};

export function operationLabel(routeId: RecoverableRouteId): string {
  return labels[routeId] ?? "正在确认操作";
}
