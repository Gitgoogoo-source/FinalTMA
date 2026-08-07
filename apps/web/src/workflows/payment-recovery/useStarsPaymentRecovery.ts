import { useEffect, useRef } from "react";

import type { PaymentOrder } from "../../domains/topup/index.ts";
import { refreshRouteScopes } from "../../platform/query/index.ts";

export function useStarsPaymentRecovery(
  orders: readonly PaymentOrder[] | undefined,
  openPaymentRecovery: (kind: PaymentOrder["kind"]) => void,
): void {
  const shown = useRef<string | null>(null);
  const loaded = useRef(false);
  const attentionOrder = orders?.find(
    (order) =>
      order.status === "processing" ||
      order.status === "paid" ||
      order.status === "payment_identity_conflict" ||
      (order.kind === "vip" && order.status === "pending"),
  );
  const attentionKey = attentionOrder
    ? `${attentionOrder.id}:${attentionOrder.status}`
    : null;
  const settlementKey =
    orders
      ?.filter(
        (order) =>
          order.status === "delivered" ||
          order.status === "refunded" ||
          order.status === "payment_identity_conflict",
      )
      .map((order) => `${order.id}:${order.status}`)
      .join("|") ?? "";
  useEffect(() => {
    if (orders === undefined) return;
    const restoring = !loaded.current;
    loaded.current = true;
    if (!attentionOrder) {
      shown.current = null;
      return;
    }
    if (
      !restoring &&
      attentionOrder.kind === "vip" &&
      attentionOrder.status === "pending"
    )
      return;
    if (shown.current === attentionKey) return;
    shown.current = attentionKey;
    openPaymentRecovery(attentionOrder.kind);
  }, [attentionKey, attentionOrder, openPaymentRecovery, orders]);
  useEffect(() => {
    if (settlementKey) void refreshRouteScopes("topup.create_order");
  }, [settlementKey]);
}
