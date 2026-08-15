import { Crown } from "lucide-react";
import type { ReactNode } from "react";
import "../../../shared/styles/shell-dialogs.css";

import { seedApiQuery, useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { t, tp } from "../../../platform/i18n/index.ts";

export function VipDialog({ close }: { close(): void }): ReactNode {
  const query = useApiQuery("vip.get");
  const { run } = useOperationCommands();
  const blocked = useOperationBlocked("vip.create_order");
  const attentionOrder = query.data?.payment_attention_order;
  const order = () =>
    void run(t("正在创建 VIP 月卡订单"), "vip.create_order", {}).then(
      (result) => {
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
                t("正在取消未付款月卡订单"),
                "vip.cancel_order",
                { order_id: result.id },
                { background: true },
              );
              return;
            }
            void query.refetch();
          });
      },
    );
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
        <h2 id="vip-dialog-title">{t("PokePets VIP 月卡")}</h2>
        {query.isLoading ? (
          <p>{t("正在加载 VIP 权益")}</p>
        ) : query.error ? (
          <Button onClick={() => void query.refetch()}>{t("重新加载")}</Button>
        ) : (
          <>
            <div className="vip-detail-list">
              <span>
                {t("价格")}
                <strong>{data?.stars_price} Stars</strong>
              </span>
              <span>
                {t("UTC+0 有效期")}
                <strong>
                  {data?.starts_on && data.ends_on
                    ? tp("{{0}} 至 {{1}}", [data.starts_on, data.ends_on])
                    : t("尚未开通")}
                </strong>
              </span>
              <span>
                {t("剩余权益日")}
                <strong>{tp("{{0}} 天", [data?.remaining_days ?? 0])}</strong>
              </span>
              <span>
                {t("本有效期续费")}
                <strong>{data?.renewals_used ?? 0}/2</strong>
              </span>
              <span>
                {t("今日 100 Fgems")}
                <strong>
                  {data?.active
                    ? data.fgems_claimed_today
                      ? t("已领取")
                      : t("可在开盒页领取")
                    : t("不可领取")}
                </strong>
              </span>
              <span>
                {t("今日免费稀有盲盒")}
                <strong>{freeBoxStatus(data)}</strong>
              </span>
              <span>
                {t("全部来源可用免费稀有盲盒")}
                <strong>
                  {tp("{{0}} 次", [data?.free_rare_box_available ?? 0])}
                </strong>
              </span>
            </div>
            <p className="vip-detail-note">
              {t(
                "两项每日权益仅在开盒页按 UTC+0 分别手动领取，未领取不补领；有效月卡卖家的真实成交手续费返还按系统结果结算。",
              )}
            </p>
            {identityConflict ? (
              <div className="payment-recovery">
                <strong>{t("支付身份校验异常")}</strong>
                <small>{t("本次未到账，请前往支付助手发送 /paysupport")}</small>
              </div>
            ) : activeOrder ? (
              <div className="payment-recovery">
                <strong>
                  {activeOrder.status === "processing" ||
                  activeOrder.status === "paid"
                    ? t("月卡付款确认中")
                    : t("等待月卡付款确认")}
                </strong>
                <small>{activeOrder.stars_amount} Stars</small>
                <Button onClick={() => void query.refetch()}>
                  {t("刷新结果")}
                </Button>
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
                  ? t("处理中")
                  : data?.active
                    ? data.can_renew
                      ? tp("使用 {{0}} Stars 续费", [data.stars_price])
                      : t("已达续费上限")
                    : tp("使用 {{0}} Stars 购买", [data?.stars_price])}
              </Button>
            )}
          </>
        )}
        <Button className="secondary" onClick={close}>
          {t("关闭")}
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
  if (identityConflict) return t("支付支持");
  if (paymentPending) return t("确认中");
  if (data?.active) return t("VIP 已生效");
  return data?.ends_on ? t("VIP 已过期") : t("VIP 未开通");
}

function freeBoxStatus(data: VipData): string {
  if (!data?.active) return t("不可领取");
  if (!data.free_box_claimed_today) return t("可在开盒页领取");
  return data.free_box_used_today ? t("今日已使用") : t("今日已领取");
}
