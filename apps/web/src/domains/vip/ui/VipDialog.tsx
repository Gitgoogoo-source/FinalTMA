import { Crown, Gift } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { Badge, Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

export function VipDialog({ close }: { close(): void }): ReactNode {
  const query = useApiQuery("vip.get");
  const { isBlocked, run } = useOperationRegistry();
  const blocked =
    isBlocked("vip.create_order") ||
    isBlocked("vip.claim_fgems") ||
    isBlocked("vip.claim_free_box");
  const pending = query.data?.pending_order;
  const order = () =>
    void run("正在创建 VIP 月卡订单", "vip.create_order", {}).then((result) => {
      if (result?.invoice_url)
        telegram()?.openInvoice(result.invoice_url, () => {
          void query.refetch();
        });
    });
  const claimFgems = () =>
    void run("正在领取 VIP 每日 Fgems", "vip.claim_fgems", {});
  const claimBox = () =>
    void run("正在领取 VIP 免费盲盒资格", "vip.claim_free_box", {});
  return (
    <div className="modal-backdrop">
      <div className="modal vip">
        <Crown size={42} />
        <Badge>{query.data?.active ? "VIP 已生效" : "VIP 未生效"}</Badge>
        <h2>PokePets VIP 月卡</h2>
        {query.isLoading ? (
          <p>正在读取真实权益</p>
        ) : query.error ? (
          <Button onClick={() => void query.refetch()}>重新加载</Button>
        ) : (
          <>
            <p>
              {query.data?.active
                ? `有效期至 ${query.data?.ends_on}`
                : "购买价格与有效期将在订单中确认"}
            </p>
            {pending && ["pending", "paid"].includes(pending.status) ? (
              <div className="payment-recovery">
                <strong>
                  {pending.status === "paid"
                    ? "月卡付款确认中"
                    : "等待月卡付款确认"}
                </strong>
                <small>{pending.stars_amount} Stars</small>
                <Button onClick={() => void query.refetch()}>刷新结果</Button>
              </div>
            ) : query.data?.active ? (
              <div className="benefit-actions">
                <Button
                  disabled={blocked || Boolean(query.data?.fgems_claimed_today)}
                  onClick={() => claimFgems()}
                >
                  <Gift />
                  {query.data?.fgems_claimed_today
                    ? "Fgems 已领取"
                    : "领取每日 Fgems"}
                </Button>
                <Button
                  disabled={
                    blocked || Boolean(query.data?.free_box_claimed_today)
                  }
                  onClick={() => claimBox()}
                >
                  <Gift />
                  {query.data?.free_box_claimed_today
                    ? "盲盒资格已领取"
                    : "领取免费盲盒资格"}
                </Button>
              </div>
            ) : (
              <Button disabled={blocked} onClick={order}>
                使用 Telegram Stars 购买
              </Button>
            )}
          </>
        )}
        <Button className="secondary" onClick={close}>
          关闭
        </Button>
      </div>
    </div>
  );
}
