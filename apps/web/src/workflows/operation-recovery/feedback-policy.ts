import type { RecoverableRouteId } from "@evomypet/api-contracts/app-client";
import { tr } from "../../platform/i18n/index.ts";

// Presentation only. These commands still use the operation registry and its
// idempotency, validation, route locks, and recovery paths.
export const compactFeedbackRoutes = new Set<RecoverableRouteId>([
  "vip.create_order",
  "tasks.check_in",
  "tasks.claim",
  "expedition.create",
  "expedition.claim",
  "vip.claim_fgems",
  "vip.claim_free_box",
  "market.create_listing",
  "market.cancel_template_listings",
  "market.purchase",
]);

export function feedbackTitle(routeId: RecoverableRouteId): string {
  switch (routeId) {
    case "vip.create_order":
      return tr("Payment ready", "可以付款了");
    case "tasks.check_in":
      return tr("Checked in", "签到成功");
    case "market.create_listing":
      return tr("Listed for sale", "已上架");
    case "market.cancel_template_listings":
      return tr("Listings removed", "已下架");
    case "market.purchase":
      return tr("Added to your collection", "已加入藏品");
    case "expedition.create":
      return tr("Your team is on its way", "小队已出发");
    case "vip.claim_free_box":
      return tr("Rare box ready to open", "稀有盲盒已领取");
    default:
      return tr("Reward collected", "奖励已领取");
  }
}

// Values have passed the route contract before reaching the success notice.
export function feedbackDetail(
  routeId: RecoverableRouteId,
  result: unknown,
): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as Record<string, unknown>;
  const amount =
    routeId === "tasks.check_in"
      ? value.reward_amount
      : routeId === "vip.claim_fgems"
        ? value.amount
        : value.reward_fgems;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return undefined;
  return routeId === "tasks.check_in" && value.reward_kind === "free_rare_box"
    ? `${tr("Rare Mystery Box", "稀有盲盒")} +${amount}`
    : `Gems +${amount}`;
}
