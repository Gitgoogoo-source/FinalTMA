import { Coins, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import type { TopupRequest } from "../../../workflows/payment-recovery/index.ts";

export function TopupDialog({
  close,
  request,
}: {
  close(): void;
  request: TopupRequest | null;
}): ReactNode {
  const [amount, setAmount] = useState("");
  const status = useApiQuery("topup.bootstrap");
  const { isBlocked, run } = useOperationRegistry();
  const blocked = isBlocked("topup.create_order");
  const create = () => {
    const input =
      amount === "exact_gap" && request
        ? ({ mode: "exact_gap", intent: request.intent } as const)
        : ({
            mode: "fixed",
            amount: Number(amount) as 50 | 500 | 1000 | 5000 | 10000,
            ...(request ? { intent: request.intent } : {}),
          } as const);
    void run("正在创建 Telegram Stars 订单", "topup.create_order", input).then(
      (result) => {
        const invoice = result?.invoice_url ?? "";
        if (invoice)
          telegram()?.openInvoice(invoice, () => {
            void status.refetch();
          });
      },
    );
  };
  const amounts = status.data?.products ?? [];
  const payments = (status.data?.orders ?? []).filter(
    (payment) =>
      payment.kind === "kcoin_topup" &&
      (payment.status === "pending" || payment.status === "paid"),
  );
  return (
    <div className="modal-backdrop">
      <div className="modal topup">
        <Coins size={38} />
        <h2>K-coin 充值</h2>
        <p>
          {request
            ? `原操作预计还差 ${request.estimatedGap} K-coin；最新差额与可用档位由服务器重新确认。`
            : "选择服务器返回的充值档位。Stars 金额和 K-coin 到账值均由订单确认。"}
        </p>
        {payments.length > 0 && (
          <div className="payment-recovery">
            <strong>待恢复订单</strong>
            {payments.map((payment) => (
              <button key={payment.id} onClick={() => void status.refetch()}>
                <span>{payment.stars_amount} Stars</span>
                <small>
                  {payment.status === "paid" ? "正在确认到账" : "等待支付确认"}
                </small>
              </button>
            ))}
          </div>
        )}
        {status.isLoading ? (
          <p>正在读取充值档位</p>
        ) : status.error ? (
          <Button onClick={() => void status.refetch()}>重新加载</Button>
        ) : (
          <div className="amount-grid">
            {request && (
              <button
                className={amount === "exact_gap" ? "selected" : ""}
                onClick={() => setAmount("exact_gap")}
              >
                补足预计差额
              </button>
            )}
            {amounts.map((value) => (
              <button
                key={value}
                className={amount === String(value) ? "selected" : ""}
                onClick={() => setAmount(String(value))}
              >
                {value}
              </button>
            ))}
          </div>
        )}
        <div className="button-row">
          <Button className="secondary" disabled={blocked} onClick={close}>
            返回
          </Button>
          <Button
            disabled={
              blocked || (amount !== "exact_gap" && Number(amount) <= 0)
            }
            onClick={create}
          >
            <ExternalLink />
            打开 Stars 支付
          </Button>
        </div>
      </div>
    </div>
  );
}
