import { useEffect, useRef } from "react";

import type { PaymentOrder } from "../../domains/topup/index.ts";
import { refreshRouteScopes } from "../../platform/query/index.ts";

export function useStarsPaymentRecovery(
  orders: readonly PaymentOrder[] | undefined,
  openPaymentRecovery: (kind: PaymentOrder["kind"]) => void,
): void {
  const shown = useRef<string | null>(null);
  const pendingOrder = orders?.find(
    (order) =>
      order.status === "processing" ||
      order.status === "paid" ||
      (order.kind === "vip" && order.status === "pending"),
  );
  const settlementKey =
    orders
      ?.filter(
        (order) => order.status === "delivered" || order.status === "refunded",
      )
      .map((order) => `${order.id}:${order.status}`)
      .join("|") ?? "";
  useEffect(() => {
    if (!pendingOrder) {
      shown.current = null;
      return;
    }
    if (shown.current === pendingOrder.id) return;
    shown.current = pendingOrder.id;
    openPaymentRecovery(pendingOrder.kind);
  }, [openPaymentRecovery, pendingOrder]);
  useEffect(() => {
    if (settlementKey) void refreshRouteScopes("topup.create_order");
  }, [settlementKey]);
}
