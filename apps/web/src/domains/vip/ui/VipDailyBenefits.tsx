import { Check, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useAppNavigate } from "../../../platform/navigation/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { notifyFreeRareClaimed } from "../../../shared/events/vipDailyBenefits.ts";
import { usePageModulePreparation } from "../../../shared/navigation/pageModulePreparation.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { t, tp } from "../../../platform/i18n/index.ts";

type Benefit = "fgems" | "freeBox";
type Feedback = {
  status: "success" | "failed";
  benefitDate: string;
};

export function VipDailyBenefits(): ReactNode {
  const vip = useApiQuery("vip.get");
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  const { present, run } = useOperationCommands();
  const [pending, setPending] = useState<Partial<Record<Benefit, boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<Benefit, Feedback>>>(
    {},
  );
  const fgemsOperationBlocked = useOperationBlocked("vip.claim_fgems");
  const freeBoxOperationBlocked = useOperationBlocked("vip.claim_free_box");
  const fgemsPending = Boolean(pending.fgems) || fgemsOperationBlocked;
  const freeBoxPending = Boolean(pending.freeBox) || freeBoxOperationBlocked;
  const data = vip.data;
  const benefitDate = data?.benefit_date ?? null;
  const refetchVip = vip.refetch;
  const loadFailed = Boolean(vip.error);
  const unavailable = vip.isLoading || loadFailed || !data;
  const paymentPending = Boolean(
    data?.payment_attention_order &&
    ["pending", "processing", "paid"].includes(
      data.payment_attention_order.status,
    ),
  );

  useEffect(() => {
    let utcRefreshTimer: number | undefined;
    const refreshAfterUtcChange = () => {
      if (
        benefitDate !== null &&
        document.visibilityState === "visible" &&
        benefitDate !== new Date().toISOString().slice(0, 10)
      )
        void refetchVip();
    };
    const scheduleUtcRefresh = () => {
      if (utcRefreshTimer !== undefined) window.clearTimeout(utcRefreshTimer);
      const now = new Date();
      const currentUtcDay = now.toISOString().slice(0, 10);
      const nextUtcDay = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      const retryStaleBenefitDate =
        benefitDate !== null &&
        benefitDate !== currentUtcDay &&
        document.visibilityState === "visible";
      utcRefreshTimer = window.setTimeout(
        () => {
          utcRefreshTimer = undefined;
          refreshAfterUtcChange();
          scheduleUtcRefresh();
        },
        retryStaleBenefitDate
          ? 30_000
          : Math.max(0, nextUtcDay - now.getTime()) + 1_000,
      );
    };
    const onVisibilityChange = () => {
      refreshAfterUtcChange();
      scheduleUtcRefresh();
    };
    refreshAfterUtcChange();
    scheduleUtcRefresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (utcRefreshTimer !== undefined) window.clearTimeout(utcRefreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [benefitDate, refetchVip]);

  const openDetails = () => {
    preparePage("/market?vip=details");
    navigate("/market?vip=details");
  };
  const claim = async (benefit: Benefit) => {
    if (pending[benefit]) return;
    const routeId =
      benefit === "fgems" ? "vip.claim_fgems" : "vip.claim_free_box";
    setPending((current) => ({ ...current, [benefit]: true }));
    setFeedback((current) => ({ ...current, [benefit]: undefined }));
    const result = await run(
      benefit === "fgems"
        ? t("正在领取 VIP 每日 100 Gems")
        : t("正在领取 VIP 免费稀有盲盒资格"),
      routeId,
      {},
      {
        dialog: false,
        retainOnFailure: true,
      },
    );
    setPending((current) => ({ ...current, [benefit]: false }));
    setFeedback((current) => ({
      ...current,
      [benefit]: {
        status: result ? "success" : "failed",
        benefitDate: data?.benefit_date ?? "",
      },
    }));
    if (result && benefit === "freeBox") notifyFreeRareClaimed();
    present(routeId);
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
  const statusText = vipStatusText(data, paymentPending, vip.isLoading);
  const fgemsAction = benefitButtonText({
    active,
    expired,
    claimed: fgemsClaimed,
    pending: fgemsPending,
    loading: unavailable,
    loadFailed,
    available: t("领取 100 Gems"),
  });
  const freeBoxAction = benefitButtonText({
    active,
    expired,
    claimed: freeBoxClaimed,
    used: Boolean(data?.free_box_used_today),
    pending: freeBoxPending,
    loading: unavailable,
    loadFailed,
    available: t("领取免费稀有盲盒"),
  });
  const fgemsVisualState = benefitVisualState({
    active,
    claimed: fgemsClaimed,
    pending: fgemsPending,
    loading: vip.isLoading || (!data && !loadFailed),
    loadFailed,
  });
  const freeBoxVisualState = benefitVisualState({
    active,
    claimed: freeBoxClaimed,
    pending: freeBoxPending,
    loading: vip.isLoading || (!data && !loadFailed),
    loadFailed,
  });
  const fgemsDisabled =
    fgemsPending || (!loadFailed && (unavailable || (active && fgemsClaimed)));
  const freeBoxDisabled =
    freeBoxPending ||
    (!loadFailed && (unavailable || (active && freeBoxClaimed)));
  const prepareDetails = () => {
    if (!active && !loadFailed) preparePage("/market?vip=details");
  };
  const activateBenefit = (benefit: Benefit) => {
    if (loadFailed) {
      void vip.refetch();
      return;
    }
    if (active) void claim(benefit);
    else openDetails();
  };

  return (
    <aside
      className="vip-daily-benefits"
      aria-label={tp("月卡每日权益，{{0}}", [statusText])}
      aria-live="polite"
    >
      <div className="vip-benefit-grid">
        <article className="vip-benefit-item vip-benefit-fgems">
          <Button
            className={`vip-benefit-tile fgems ${fgemsVisualState}`}
            disabled={fgemsDisabled}
            aria-label={tp("100 Gems，每个 UTC+0 日手动领取，{{0}}", [
              fgemsAction,
            ])}
            onPointerEnter={prepareDetails}
            onPointerDown={prepareDetails}
            onFocus={prepareDetails}
            onClick={() => activateBenefit("fgems")}
          >
            <img
              src="/assets/vip/daily-fgems.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <BenefitStateIcon state={fgemsVisualState} />
          </Button>
          <BenefitFeedback
            feedback={fgemsFeedbackStatus}
            claimed={fgemsClaimed}
            success={t("领取成功，Gems +100")}
          />
        </article>

        <article className="vip-benefit-item vip-benefit-free-box">
          <Button
            className={`vip-benefit-tile free-box ${freeBoxVisualState}`}
            disabled={freeBoxDisabled}
            aria-label={tp(
              "免费稀有盲盒 1 次，全部来源当前可用 {{0}} 次，{{1}}",
              [data?.free_rare_box_available ?? "—", freeBoxAction],
            )}
            onPointerEnter={prepareDetails}
            onPointerDown={prepareDetails}
            onFocus={prepareDetails}
            onClick={() => activateBenefit("freeBox")}
          >
            <img
              src="/assets/vip/daily-rare-egg.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <BenefitStateIcon state={freeBoxVisualState} />
          </Button>
          <BenefitFeedback
            feedback={freeBoxFeedbackStatus}
            claimed={freeBoxClaimed}
            success={t("领取成功，免费稀有盲盒次数 +1")}
          />
        </article>
      </div>
    </aside>
  );
}

type BenefitVisualState =
  | "claimable"
  | "claimed"
  | "loading"
  | "locked"
  | "retry";

function BenefitStateIcon({ state }: { state: BenefitVisualState }): ReactNode {
  if (state === "claimable") return null;
  return (
    <span className="benefit-state" aria-hidden="true">
      {state === "claimed" ? (
        <Check />
      ) : state === "locked" ? (
        <LockKeyhole />
      ) : state === "retry" ? (
        <RefreshCw />
      ) : (
        <LoaderCircle className="spin" />
      )}
    </span>
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
    <span className="vip-benefit-status-text" role="status">
      {feedback === "success"
        ? success
        : claimed
          ? t("今日权益已领取，未重复发放")
          : t("领取未成功，已刷新最新状态")}
    </span>
  );
}

function benefitVisualState({
  active,
  claimed,
  pending,
  loading,
  loadFailed,
}: {
  active: boolean;
  claimed: boolean;
  pending: boolean;
  loading: boolean;
  loadFailed: boolean;
}): BenefitVisualState {
  if (pending || loading) return "loading";
  if (loadFailed) return "retry";
  if (!active) return "locked";
  return claimed ? "claimed" : "claimable";
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
  if (pending) return t("领取中");
  if (loadFailed) return t("加载失败，点击重试");
  if (loading) return t("状态加载中");
  if (active)
    return claimed ? (used ? t("今日已使用") : t("今日已领取")) : available;
  return expired ? t("月卡已过期") : t("购买月卡后可领取");
}

function vipStatusText(
  data: ReturnType<typeof useApiQuery<"vip.get">>["data"],
  paymentPending: boolean,
  loading: boolean,
): string {
  if (loading) return t("正在确认月卡状态");
  if (!data) return t("月卡状态确认失败");
  if (paymentPending)
    return data.active
      ? t("月卡有效，续费结果仍在确认")
      : t("月卡付款结果仍在确认");
  if (data.active)
    return tp("有效期至 {{0}} · 剩余 {{1}} 个权益日", [
      data.ends_on,
      data.remaining_days,
    ]);
  if (data.ends_on)
    return tp("已于 {{0}} 到期，进入详情可重新购买", [data.ends_on]);
  return t("进入交易市场月卡详情后可购买");
}
