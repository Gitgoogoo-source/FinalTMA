import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { PaymentOrder } from "../../domains/topup/index.ts";

export function useNavigationIntentResume(
  orders: readonly PaymentOrder[] | undefined,
  onResume: () => void,
): void {
  const navigate = useNavigate();
  useEffect(() => {
    const order = orders?.find(
      (candidate) =>
        candidate.status === "delivered" &&
        candidate.intent &&
        sessionStorage.getItem(`pokepets:resumed-payment:${candidate.id}`) !==
          "1",
    );
    if (!order?.intent) return;
    sessionStorage.setItem(`pokepets:resumed-payment:${order.id}`, "1");
    onResume();
    const params = new URLSearchParams({ resume: order.id });
    if (order.intent.kind === "gacha") {
      params.set("tier", order.intent.tier);
      params.set("count", String(order.intent.draw_count));
      navigate(`/?${params.toString()}`);
      return;
    }
    if (order.intent.kind === "market") {
      params.set("template_id", order.intent.template_id);
      params.set("quantity", String(order.intent.quantity));
      navigate(`/market?${params.toString()}`);
      return;
    }
    params.set("count", String(order.intent.count));
    navigate(`/game?${params.toString()}`);
  }, [navigate, onResume, orders]);
}
