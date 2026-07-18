import { Coins, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { records, text } from "../../shared/lib/data.ts";
import { Button } from "../../shared/ui/index.tsx";

export function TopupDialog({ close }: { close(): void }): ReactNode {
  const [amount, setAmount] = useState("");
  const bootstrap = useApiQuery("me.bootstrap");
  const status = useApiQuery("topup.status");
  const { blocked, run } = useOperation();
  const create = () =>
    void run("正在创建 Telegram Stars 订单", async () => {
      const response = await apiRequest(
        "topup.create_order",
        { amount: Number(amount) },
        { idempotencyKey: newIdempotencyKey() },
      );
      const invoice = text(response.data.invoice_url, "");
      if (invoice)
        telegram()?.openInvoice(invoice, () => {
          void status.refetch();
        });
      return { data: response.data, operationId: response.operationId };
    });
  const amounts = Array.isArray(bootstrap.data?.topup_amounts)
    ? bootstrap.data.topup_amounts.filter(
        (value): value is number => typeof value === "number",
      )
    : [];
  const payments = records(status.data?.payments);
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
                key={text(payment.id)}
                onClick={() => void status.refetch()}
              >
                <span>{text(payment.stars_amount)} Stars</span>
                <small>
                  {payment.status === "paid" ? "正在确认到账" : "等待支付确认"}
                </small>
              </button>
            ))}
          </div>
        )}
        {bootstrap.isLoading ? (
          <p>正在读取充值档位</p>
        ) : bootstrap.error ? (
          <Button onClick={() => void bootstrap.refetch()}>重新加载</Button>
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
