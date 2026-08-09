import { Crown } from "lucide-react";
import type { ReactNode } from "react";
import "../../../shared/styles/shell-dialogs.css";

import { seedApiQuery, useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/context.ts";

export function VipDialog({ close }: { close(): void }): ReactNode {
  const query = useApiQuery("vip.get");
  const { isBlocked, run } = useOperationRegistry();
  const blocked = isBlocked("vip.create_order");
  const attentionOrder = query.data?.payment_attention_order;
  const order = () =>
    void run("正在创建 VIP 月卡订单", "vip.create_order", {}).then((result) => {
      if (result?.invoice_url)
        telegram()?.openInvoice(result.invoice_url, (status) => {
          if (status === "cancelled") {
            if (query.data)
              seedApiQuery(
                "vip.get",
                {},
                { ...query.data, payment_attention_order: null },
              );
            close();
            void run(
              "正在取消未付款月卡订单",
              "vip.cancel_order",
              { order_id: result.id },
              { background: true },
            );
            return;
          }
          void query.refetch();
        });
    });
  const data = query.data;
  const activeOrder =
    attentionOrder &&
    ["pending", "processing", "paid"].includes(attentionOrder.status)
      ? attentionOrder
      : null;
  const identityConflict =
    attentionOrder?.status === "payment_identity_conflict";
  return (
    <AppModal labelledBy="vip-dialog-title" onClose={close}>
      <div className="modal vip">
        <Crown size={42} />
        <Badge>
          {vipDetailStatus(data, Boolean(activeOrder), identityConflict)}
        </Badge>
        <h2 id="vip-dialog-title">PokePets VIP 月卡</h2>
        {query.isLoading ? (
          <p>正在读取真实权益</p>
        ) : query.error ? (
          <Button onClick={() => void query.refetch()}>重新加载</Button>
        ) : (
          <>
            <div className="vip-detail-list">
              <span>
                价格<strong>{data?.stars_price} Stars</strong>
              </span>
              <span>
                UTC+0 有效期
                <strong>
                  {data?.starts_on && data.ends_on
                    ? `${data.starts_on} 至 ${data.ends_on}`
                    : "尚未开通"}
                </strong>
              </span>
              <span>
                剩余权益日<strong>{data?.remaining_days ?? 0} 天</strong>
              </span>
              <span>
                本有效期续费<strong>{data?.renewals_used ?? 0}/2</strong>
              </span>
              <span>
                今日 100 Fgems
                <strong>
                  {data?.active
                    ? data.fgems_claimed_today
                      ? "已领取"
                      : "可在开盒页领取"
                    : "不可领取"}
                </strong>
              </span>
              <span>
                今日免费稀有盲盒
                <strong>{freeBoxStatus(data)}</strong>
              </span>
              <span>
                全部来源可用免费稀有盲盒
                <strong>{data?.free_rare_box_available ?? 0} 次</strong>
              </span>
            </div>
            <p className="vip-detail-note">
              两项每日权益仅在开盒页按 UTC+0
              分别手动领取，未领取不补领；有效月卡卖家的真实成交手续费返还按系统结果结算。
            </p>
            {identityConflict ? (
              <div className="payment-recovery">
                <strong>支付身份校验异常</strong>
                <small>本次未到账，请前往支付助手发送 /paysupport</small>
              </div>
            ) : activeOrder ? (
              <div className="payment-recovery">
                <strong>
                  {activeOrder.status === "processing" ||
                  activeOrder.status === "paid"
                    ? "月卡付款确认中"
                    : "等待月卡付款确认"}
                </strong>
                <small>{activeOrder.stars_amount} Stars</small>
                <Button onClick={() => void query.refetch()}>刷新结果</Button>
              </div>
            ) : (
              <Button
                disabled={
                  blocked ||
                  Boolean(data?.active ? !data.can_renew : !data?.can_purchase)
                }
                onClick={order}
              >
                {blocked
                  ? "处理中"
                  : data?.active
                    ? data.can_renew
                      ? `使用 ${data.stars_price} Stars 续费`
                      : "已达续费上限"
                    : `使用 ${data?.stars_price} Stars 购买`}
              </Button>
            )}
          </>
        )}
        <Button className="secondary" onClick={close}>
          关闭
        </Button>
      </div>
    </AppModal>
  );
}

type VipData = ReturnType<typeof useApiQuery<"vip.get">>["data"];

function vipDetailStatus(
  data: VipData,
  paymentPending: boolean,
  identityConflict: boolean,
): string {
  if (identityConflict) return "支付支持";
  if (paymentPending) return "确认中";
  if (data?.active) return "VIP 已生效";
  return data?.ends_on ? "VIP 已过期" : "VIP 未开通";
}

function freeBoxStatus(data: VipData): string {
  if (!data?.active) return "不可领取";
  if (!data.free_box_claimed_today) return "可在开盒页领取";
  return data.free_box_used_today ? "今日已使用" : "今日已领取";
}
