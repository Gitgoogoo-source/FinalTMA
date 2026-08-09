import { useEffect } from "react";

import type { PaymentOrder } from "../../domains/topup/index.ts";
import { useAppNavigate } from "../../platform/navigation/index.tsx";
import { usePageModulePreparation } from "../../shared/navigation/pageModulePreparation.ts";

const resumedPayments = new Set<string>();

export function useNavigationIntentResume(
  orders: readonly PaymentOrder[] | undefined,
  onResume: () => void,
): void {
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  useEffect(() => {
    const order = orders?.find(
      (candidate) =>
        candidate.status === "delivered" &&
        candidate.intent &&
        !resumedPayments.has(candidate.id),
    );
    if (!order?.intent) return;
    resumedPayments.add(order.id);
    onResume();
    const params = new URLSearchParams({ resume: order.id });
    if (order.intent.kind === "gacha") {
      params.set("tier", order.intent.tier);
      params.set("count", String(order.intent.draw_count));
      const path = `/?${params.toString()}`;
      preparePage(path);
      navigate(path);
      return;
    }
    if (order.intent.kind === "market") {
      params.set("template_id", order.intent.template_id);
      params.set("quantity", String(order.intent.quantity));
      const path = `/market?${params.toString()}`;
      preparePage(path);
      navigate(path);
      return;
    }
    if (
      order.intent.kind === "battle_create" ||
      order.intent.kind === "battle_matchmaking" ||
      order.intent.kind === "battle_accept"
    ) {
      const path = `/game?${params.toString()}`;
      preparePage(path);
      navigate(path);
      return;
    }
    params.set("count", String(order.intent.count));
    const path = `/tasks?${params.toString()}`;
    preparePage(path);
    navigate(path);
  }, [navigate, onResume, orders, preparePage]);
}
