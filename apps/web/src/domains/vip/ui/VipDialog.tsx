import { Crown, X, CalendarDays } from "lucide-react";
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
import { t, tp, tr } from "../../../platform/i18n/index.ts";

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
    <AppModal
      className="vip-pass-backdrop"
      labelledBy="vip-dialog-title"
      onClose={close}
    >
      <section className="modal vip vip-pass">
        <header className="vip-pass-hero">
          <img src="/assets/vip/vip-membership-hero-v4.webp" alt="" />
          <button
            className="dialog-close"
            type="button"
            onClick={close}
            aria-label={t("关闭")}
          >
            <X />
          </button>
          <div className="vip-pass-heading">
            <span>
              <Crown aria-hidden="true" /> EVOMYPET
            </span>
            <h2 id="vip-dialog-title">{tr("VIP Pass", "VIP 月卡")}</h2>
            <Badge>
              {vipDetailStatus(data, Boolean(activeOrder), identityConflict)}
            </Badge>
          </div>
        </header>
        <div className="vip-pass-content">
          {query.isLoading ? (
            <p role="status">{t("正在加载 VIP 权益")}</p>
          ) : query.error ? (
            <Button onClick={() => void query.refetch()}>
              {t("重新加载")}
            </Button>
          ) : (
            <>
              <div className="vip-pass-price">
                <div>
                  <small>
                    {data?.active
                      ? tr("Your daily adventure perks", "每天都有新的收获")
                      : tr("A little extra, every day", "每天多一份惊喜")}
                  </small>
                  <strong>
                    {data?.stars_price}
                    <span> Telegram Stars</span>
                  </strong>
                </div>
                {data?.active ? (
                  <span className="vip-days">
                    <CalendarDays aria-hidden="true" />
                    {tp("{{0}} 天", [data.remaining_days])}
                  </span>
                ) : null}
              </div>
              <div className="vip-perk-grid">
                <article>
                  <img src="/assets/vip/daily-fgems.png" alt="" />
                  <strong>100 Gems</strong>
                  <span>{tr("Every day", "每日领取")}</span>
                  <small>
                    {data?.active
                      ? data.fgems_claimed_today
                        ? t("已领取")
                        : t("可在开盒页领取")
                      : tr("With your VIP Pass", "开通后可领取")}
                  </small>
                </article>
                <article>
                  <img src="/assets/vip/vip-free-rare-ticket.webp" alt="" />
                  <strong>{tr("Rare Mystery Box", "稀有盲盒")}</strong>
                  <span>{tr("One free pull daily", "每日免费开一次")}</span>
                  <small>
                    {data?.active
                      ? freeBoxStatus(data)
                      : tr("With your VIP Pass", "开通后可领取")}
                  </small>
                </article>
              </div>
              <p className="vip-rebate-note">
                {tr(
                  "Marketplace fee rebates on eligible VIP sales.",
                  "VIP 有效期内，符合条件的市场成交可享手续费返还。",
                )}
              </p>
              {data?.active && data.ends_on ? (
                <p className="vip-expiry">
                  {tr("Valid through", "有效期至")}{" "}
                  <strong>{data.ends_on}</strong> · UTC
                </p>
              ) : null}
              <details className="dialog-rules">
                <summary>
                  {tr("Pass details & rules", "权益详情与规则")}
                </summary>
                <p>
                  {tr(
                    "Claim both daily perks from the Mystery Box page. Daily benefits reset at 00:00 UTC. Unclaimed perks are not carried over.",
                    "每日权益需在开盒页分别手动领取，每天 UTC 00:00 重置，未领取的权益不补领。",
                  )}
                </p>
                <dl>
                  <div>
                    <dt>{tr("Validity (UTC)", "有效期（UTC）")}</dt>
                    <dd>
                      {data?.starts_on && data.ends_on
                        ? `${data.starts_on} – ${data.ends_on}`
                        : t("尚未开通")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("本有效期续费")}</dt>
                    <dd>{data?.renewals_used ?? 0}/2</dd>
                  </div>
                  <div>
                    <dt>
                      {tr("Available free rare pulls", "可用免费稀有盲盒")}
                    </dt>
                    <dd>
                      {tp("{{0}} 次", [data?.free_rare_box_available ?? 0])}
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </div>
        {!query.isLoading && !query.error ? (
          <footer className="vip-pass-actions">
            {identityConflict ? (
              <div className="payment-recovery">
                <strong>
                  {tr("Payment needs attention", "这笔付款需要协助处理")}
                </strong>
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
                <small>{activeOrder.stars_amount} Telegram Stars</small>
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
                      ? tp("使用 {{0}} Telegram Stars 续费", [data.stars_price])
                      : t("已达续费上限")
                    : tp("使用 {{0}} Telegram Stars 购买", [data?.stars_price])}
              </Button>
            )}
          </footer>
        ) : null}
      </section>
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
