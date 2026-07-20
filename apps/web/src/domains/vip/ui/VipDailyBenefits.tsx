import { Crown, Gem, Gift, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

type Benefit = "fgems" | "freeBox";
type Feedback = {
  status: "success" | "failed";
  benefitDate: string;
};

export function VipDailyBenefits({
  onFreeRareClaimed,
}: {
  onFreeRareClaimed(): void;
}): ReactNode {
  const vip = useApiQuery("vip.get");
  const navigate = useNavigate();
  const { isBlocked, run } = useOperationRegistry();
  const [pending, setPending] = useState<Partial<Record<Benefit, boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<Benefit, Feedback>>>(
    {},
  );
  const fgemsPending = Boolean(pending.fgems) || isBlocked("vip.claim_fgems");
  const freeBoxPending =
    Boolean(pending.freeBox) || isBlocked("vip.claim_free_box");
  const data = vip.data;
  const refetchVip = vip.refetch;
  const loadFailed = Boolean(vip.error);
  const unavailable = vip.isLoading || loadFailed || !data;
  const paymentPending = Boolean(
    data?.pending_order &&
    ["pending", "processing", "paid"].includes(data.pending_order.status),
  );

  useEffect(() => {
    void refetchVip();
  }, [refetchVip]);

  useEffect(() => {
    const refreshAfterUtcChange = () => {
      if (
        document.visibilityState === "visible" &&
        data?.benefit_date !== new Date().toISOString().slice(0, 10)
      )
        void refetchVip();
    };
    const interval = window.setInterval(refreshAfterUtcChange, 30_000);
    document.addEventListener("visibilitychange", refreshAfterUtcChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshAfterUtcChange);
    };
  }, [data?.benefit_date, refetchVip]);

  const openDetails = () => navigate("/market?vip=details");
  const claim = async (benefit: Benefit) => {
    if (pending[benefit]) return;
    setPending((current) => ({ ...current, [benefit]: true }));
    setFeedback((current) => ({ ...current, [benefit]: undefined }));
    const result = await run(
      benefit === "fgems"
        ? "正在领取 VIP 每日 100 Fgems"
        : "正在领取 VIP 免费稀有盲盒资格",
      benefit === "fgems" ? "vip.claim_fgems" : "vip.claim_free_box",
      {},
    );
    setPending((current) => ({ ...current, [benefit]: false }));
    setFeedback((current) => ({
      ...current,
      [benefit]: {
        status: result ? "success" : "failed",
        benefitDate: data?.benefit_date ?? "",
      },
    }));
    if (result && benefit === "freeBox") onFreeRareClaimed();
  };

  const active = Boolean(data?.active);
  const expired = !active && Boolean(data?.ends_on);
  const fgemsClaimed = Boolean(data?.fgems_claimed_today);
  const freeBoxClaimed = Boolean(data?.free_box_claimed_today);
  const fgemsFeedback = feedback.fgems;
  const freeBoxFeedback = feedback.freeBox;
  const fgemsFeedbackStatus =
    fgemsFeedback && fgemsFeedback.benefitDate === data?.benefit_date
      ? fgemsFeedback.status
      : undefined;
  const freeBoxFeedbackStatus =
    freeBoxFeedback && freeBoxFeedback.benefitDate === data?.benefit_date
      ? freeBoxFeedback.status
      : undefined;

  return (
    <Card className="vip-daily-benefits" aria-live="polite">
      <div className="vip-benefit-heading">
        <span className="vip-benefit-mark">
          <Crown aria-hidden="true" />
        </span>
        <div>
          <span>VIP MONTHLY PASS</span>
          <strong>月卡每日权益</strong>
          <small>{vipStatusText(data, paymentPending, vip.isLoading)}</small>
        </div>
        <Badge>
          {vipStatusBadge(data, paymentPending, vip.isLoading, vip.error)}
        </Badge>
      </div>

      {loadFailed && (
        <div className="vip-benefit-error">
          <span>月卡状态加载失败，领取入口已停用</span>
          <Button onClick={() => void vip.refetch()}>
            <RefreshCw size={15} />
            重新加载
          </Button>
        </div>
      )}
      <div className="vip-benefit-grid">
        <article>
          <span className="benefit-icon fgems">
            <Gem aria-hidden="true" />
          </span>
          <div>
            <strong>100 Fgems</strong>
            <small>每个 UTC+0 日手动领取</small>
            <BenefitFeedback
              feedback={fgemsFeedbackStatus}
              claimed={fgemsClaimed}
              success="领取成功，Fgems +100"
            />
          </div>
          <Button
            disabled={unavailable || fgemsPending || (active && fgemsClaimed)}
            onClick={() => (active ? void claim("fgems") : openDetails())}
          >
            {benefitButtonText({
              active,
              expired,
              claimed: fgemsClaimed,
              pending: fgemsPending,
              loading: unavailable,
              loadFailed,
              available: "领取 100 Fgems",
            })}
          </Button>
        </article>

        <article>
          <span className="benefit-icon free-box">
            <Gift aria-hidden="true" />
          </span>
          <div>
            <strong>免费稀有盲盒 ×1</strong>
            <small>
              全部来源当前可用 {data?.free_rare_box_available ?? "—"} 次
            </small>
            <BenefitFeedback
              feedback={freeBoxFeedbackStatus}
              claimed={freeBoxClaimed}
              success="领取成功，免费稀有盲盒次数 +1"
            />
          </div>
          <Button
            disabled={
              unavailable || freeBoxPending || (active && freeBoxClaimed)
            }
            onClick={() => (active ? void claim("freeBox") : openDetails())}
          >
            {benefitButtonText({
              active,
              expired,
              claimed: freeBoxClaimed,
              used: Boolean(data?.free_box_used_today),
              pending: freeBoxPending,
              loading: unavailable,
              loadFailed,
              available: "领取免费稀有盲盒",
            })}
          </Button>
        </article>
      </div>
    </Card>
  );
}

function BenefitFeedback({
  feedback,
  claimed,
  success,
}: {
  feedback: Feedback["status"] | undefined;
  claimed: boolean;
  success: string;
}): ReactNode {
  if (!feedback) return null;
  return (
    <span className={feedback === "failed" && !claimed ? "error-text" : ""}>
      {feedback === "success"
        ? success
        : claimed
          ? "服务器确认今日已领取，未重复发放"
          : "领取未成功，已刷新真实状态"}
    </span>
  );
}

function benefitButtonText({
  active,
  expired,
  claimed,
  used = false,
  pending,
  loading,
  loadFailed,
  available,
}: {
  active: boolean;
  expired: boolean;
  claimed: boolean;
  used?: boolean;
  pending: boolean;
  loading: boolean;
  loadFailed: boolean;
  available: string;
}): string {
  if (pending) return "领取中";
  if (loadFailed) return "加载失败";
  if (loading) return "状态加载中";
  if (active) return claimed ? (used ? "今日已使用" : "今日已领取") : available;
  return expired ? "月卡已过期" : "购买月卡后可领取";
}

function vipStatusBadge(
  data: ReturnType<typeof useApiQuery<"vip.get">>["data"],
  paymentPending: boolean,
  loading: boolean,
  error: Error | null,
): string {
  if (loading) return "加载中";
  if (error) return "加载失败";
  if (paymentPending) return "付款确认中";
  if (data?.active) return "有效";
  return data?.ends_on ? "已过期" : "未开通";
}

function vipStatusText(
  data: ReturnType<typeof useApiQuery<"vip.get">>["data"],
  paymentPending: boolean,
  loading: boolean,
): string {
  if (loading) return "正在读取真实月卡状态";
  if (!data) return "无法读取真实月卡状态";
  if (paymentPending)
    return data.active ? "月卡有效，续费结果仍在确认" : "月卡付款结果仍在确认";
  if (data.active)
    return `有效期至 ${data.ends_on} · 剩余 ${data.remaining_days} 个权益日`;
  if (data.ends_on) return `已于 ${data.ends_on} 到期，进入详情可重新购买`;
  return "进入交易市场月卡详情后可购买";
}
