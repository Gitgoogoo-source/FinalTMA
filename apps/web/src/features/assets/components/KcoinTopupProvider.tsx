import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CreateKcoinTopupOrderResponse,
  KcoinTopupAmount,
} from "../assets.types";
import { useCreateKcoinTopupOrder } from "../hooks/useCreateKcoinTopupOrder";
import { useKcoinTopupPayment } from "../hooks/useKcoinTopupPayment";
import type { KcoinTopupInvoiceCallbackResult } from "../hooks/useKcoinTopupPayment";
import { useKcoinTopupStatus } from "../hooks/useKcoinTopupStatus";
import { useMyAssets } from "../hooks/useMyAssets";
import { KcoinTopupSheet, type KcoinTopupNotice } from "./KcoinTopupSheet";

type OpenKcoinTopupSheetOptions = {
  requiredAmount?: number | null;
};

type KcoinTopupContextValue = {
  openKcoinTopupSheet: (options?: OpenKcoinTopupSheetOptions) => void;
};

type KcoinTopupProviderProps = {
  children: ReactNode;
};

const KcoinTopupContext = createContext<KcoinTopupContextValue>({
  openKcoinTopupSheet: () => undefined,
});

export function KcoinTopupProvider({ children }: KcoinTopupProviderProps) {
  const { pushToast } = useFeedback();
  const assetsQuery = useMyAssets();
  const { refreshAssets } = assetsQuery;
  const currentBalance = useMemo(
    () => readAssetAmount(assetsQuery.assets.kcoin.available),
    [assetsQuery.assets.kcoin.available],
  );
  const [open, setOpen] = useState(false);
  const [requiredAmount, setRequiredAmount] = useState(0);
  const [pendingAmount, setPendingAmount] = useState<KcoinTopupAmount | null>(
    null,
  );
  const [activeOrder, setActiveOrder] =
    useState<CreateKcoinTopupOrderResponse | null>(null);
  const [invoiceNotice, setInvoiceNotice] = useState<KcoinTopupNotice | null>(
    null,
  );
  const completedOrderRef = useRef<string | null>(null);
  const createOrder = useCreateKcoinTopupOrder();
  const openInvoice = useKcoinTopupPayment();
  const activeOrderId = activeOrder?.topupOrderId ?? null;
  const statusQuery = useKcoinTopupStatus(activeOrderId, {
    enabled: activeOrder !== null,
  });

  const openKcoinTopupSheet = useCallback(
    (options: OpenKcoinTopupSheetOptions = {}) => {
      setRequiredAmount(Math.max(Number(options.requiredAmount ?? 0), 0));
      setOpen(true);
    },
    [],
  );

  const handleInvoiceStatus = useCallback(
    (result: KcoinTopupInvoiceCallbackResult) => {
      if (result.status === "paid") {
        setInvoiceNotice({
          status: "paid",
        });
        void statusQuery.refetch();
        pushToast({
          type: "info",
          title: "充值支付已返回",
          message: "正在等待 Telegram webhook 和服务端确认到账。",
        });
        return;
      }

      if (result.status === "pending" || result.status === "unknown") {
        setInvoiceNotice({
          status: "pending",
          detail: result.rawStatus
            ? `Telegram 返回状态 ${result.rawStatus}，请以服务端状态为准。`
            : "Telegram 暂未返回明确支付状态，请以服务端状态为准。",
        });
        void statusQuery.refetch();
        return;
      }

      if (result.status === "cancelled" || result.status === "failed") {
        setInvoiceNotice({
          status: result.status,
        });
        pushToast({
          type: result.status === "failed" ? "error" : "info",
          title: result.status === "failed" ? "充值未完成" : "支付窗口已关闭",
          message: "K-coin 只会在 Telegram 支付成功并由服务端确认后到账。",
        });
      }
    },
    [pushToast, statusQuery],
  );

  const openInvoiceForOrder = useCallback(
    (order: CreateKcoinTopupOrderResponse) => {
      setInvoiceNotice({
        status: "opening",
      });
      const openAttempt = openInvoice(order, handleInvoiceStatus);

      if (!openAttempt.ok) {
        setInvoiceNotice({
          status: "not_opened",
          detail: openAttempt.message,
        });
        pushToast({
          type: "error",
          title: "充值支付未打开",
          message: openAttempt.message,
        });
        return;
      }

      pushToast({
        type: "info",
        title: "充值支付已打开",
        message: `${formatCurrencyAmount(order.kcoinAmount)} K-coin 对应 ${formatCurrencyAmount(order.xtrAmount)} Stars。`,
      });
    },
    [handleInvoiceStatus, openInvoice, pushToast],
  );

  const handleSelectAmount = useCallback(
    (amount: KcoinTopupAmount) => {
      if (createOrder.isPending || activeOrder) {
        return;
      }

      setPendingAmount(amount);
      createOrder.mutate(
        {
          amount,
        },
        {
          onSuccess: (order) => {
            completedOrderRef.current = null;
            setActiveOrder(order);
            openInvoiceForOrder(order);
          },
          onError: (error) => {
            pushToast({
              type: "error",
              title: "创建充值订单失败",
              message: getApiErrorMessage(error),
            });
          },
          onSettled: () => {
            setPendingAmount(null);
          },
        },
      );
    },
    [activeOrder, createOrder, openInvoiceForOrder, pushToast],
  );

  const handleRetryPayment = useCallback(() => {
    if (!activeOrder) {
      return;
    }

    openInvoiceForOrder(activeOrder);
  }, [activeOrder, openInvoiceForOrder]);

  const handleClearOrder = useCallback(() => {
    setActiveOrder(null);
    setInvoiceNotice(null);
  }, []);

  useEffect(() => {
    const snapshot = statusQuery.statusSnapshot;

    if (!snapshot || !activeOrder) {
      return;
    }

    if (snapshot.topupOrderId !== activeOrder.topupOrderId) {
      return;
    }

    if (
      snapshot.paymentOrderStatus === "fulfilled" &&
      snapshot.fulfillment.credited
    ) {
      if (completedOrderRef.current === snapshot.topupOrderId) {
        return;
      }

      completedOrderRef.current = snapshot.topupOrderId;
      void refreshAssets();
      setInvoiceNotice({
        status: "fulfilled",
      });
      setActiveOrder(null);
      setOpen(false);
      pushToast({
        type: "success",
        title: "K-coin 已到账",
        message: `${formatCurrencyAmount(snapshot.kcoinAmount)} K-coin 已刷新到顶部资产栏。`,
      });
      return;
    }

    if (snapshot.paymentOrderStatus === "paid") {
      setInvoiceNotice({
        status: "paid",
      });
    }

    if (snapshot.paymentOrderStatus === "expired") {
      setInvoiceNotice({
        status: "expired",
      });
    }

    if (snapshot.paymentOrderStatus === "failed") {
      setInvoiceNotice({
        status: "failed",
      });
    }
  }, [activeOrder, pushToast, refreshAssets, statusQuery.statusSnapshot]);

  const value = useMemo<KcoinTopupContextValue>(
    () => ({
      openKcoinTopupSheet,
    }),
    [openKcoinTopupSheet],
  );

  return (
    <KcoinTopupContext.Provider value={value}>
      {children}
      <KcoinTopupSheet
        open={open}
        currentBalance={currentBalance}
        requiredAmount={requiredAmount}
        activeOrder={activeOrder}
        statusSnapshot={statusQuery.statusSnapshot}
        invoiceNotice={invoiceNotice}
        pendingAmount={pendingAmount}
        isCreating={createOrder.isPending}
        isCheckingStatus={statusQuery.isFetching}
        onSelectAmount={handleSelectAmount}
        onRetryPayment={handleRetryPayment}
        onCheckStatus={() => void statusQuery.refetch()}
        onClearOrder={handleClearOrder}
        onClose={() => setOpen(false)}
      />
    </KcoinTopupContext.Provider>
  );
}

export function useKcoinTopupSheet(): KcoinTopupContextValue {
  return useContext(KcoinTopupContext);
}

function readAssetAmount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
