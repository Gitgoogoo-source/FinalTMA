import { Coins, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { Button } from "../../shared/ui/index.tsx";

export function TopupDialog({ close }: { close(): void }): ReactNode {
  const [amount, setAmount] = useState("");
  const status = useApiQuery("topup.bootstrap");
  const { blocked, run } = useOperation();
  const create = () =>
    void run("正在创建 Telegram Stars 订单", async () => {
      const response = await apiRequest(
        "topup.create_order",
        { mode: "fixed", amount: Number(amount) as 50 | 500 | 1000 | 5000 | 10000 },
        { idempotencyKey: newIdempotencyKey() },
      );
      const invoice = response.data.invoice_url ?? "";
      if (invoice)
        telegram()?.openInvoice(invoice, () => {
          void status.refetch();
        });
      return { data: response.data, operationId: response.operationId };
    });
  const amounts = status.data?.products ?? [];
  const payments = status.data?.orders ?? [];
  return (
    <div className="modal-backdrop">
      <div className="modal topup">
        <Coins size={38} />
        <h2>K-coin 充值</h2>
        <p>
          选择服务器返回的充值档位。Stars 金额和 K-coin 到账值均由订单确认。
        </p>
        {payments.length > 0 && (
          <div className="payment-recovery">
            <strong>待恢复订单</strong>
            {payments.map((payment) => (
              <button
                key={payment.id}
                onClick={() => void status.refetch()}
              >
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
          <Button disabled={blocked || Number(amount) <= 0} onClick={create}>
            <ExternalLink />
            打开 Stars 支付
          </Button>
        </div>
      </div>
    </div>
  );
}
