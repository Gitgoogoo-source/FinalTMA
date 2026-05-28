import { useEffect, useState } from "react";

import {
  readPendingStarsPaymentOrder,
  type PendingStarsPaymentOrder,
} from "./useStarsPayment";

export function usePendingDrawOrder(): PendingStarsPaymentOrder | null {
  const [pendingOrder, setPendingOrder] =
    useState<PendingStarsPaymentOrder | null>(null);

  useEffect(() => {
    setPendingOrder(readPendingStarsPaymentOrder());
  }, []);

  return pendingOrder;
}
