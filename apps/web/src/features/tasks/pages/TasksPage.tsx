import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { ActivityBanner } from "@/features/banners/components/ActivityBanner";
import { useBanners } from "@/features/banners/hooks/useBanners";
import type { RewardModalItem } from "@/features/feedback/feedback.types";
import { openTelegramShareLink } from "@/shared/lib/telegramShare";

import { CommissionStatsPanel } from "../components/CommissionStatsPanel";
import { InviteCampaignCard } from "../components/InviteCampaignCard";
import { InviteStatsPanel } from "../components/InviteStatsPanel";
import { ReferralLinkSheet } from "../components/ReferralLinkSheet";
import { RewardHistoryPanel } from "../components/RewardHistoryEntry";
import { SevenDayCheckIn } from "../components/SevenDayCheckIn";
import { TaskCategoryTabs } from "../components/TaskCategoryTabs";
import { TaskList } from "../components/TaskList";
import { useCheckInStatus } from "../hooks/useCheckInStatus";
import { useClaimCommission } from "../hooks/useClaimCommission";
import { useClaimTask } from "../hooks/useClaimTask";
import { useCommissionHistory } from "../hooks/useCommissionHistory";
import { useDailyCheckIn } from "../hooks/useDailyCheckIn";
import { useInviteShare } from "../hooks/useInviteShare";
import { useInviteStats } from "../hooks/useInviteStats";
import { useReferralLink } from "../hooks/useReferralLink";
import { useTasks } from "../hooks/useTasks";
import type {
  ClaimCommissionResult,
  ClaimTaskResult,
  DailyCheckInResult,
  ReferralLink,
  TaskCategoryFilter,
  TaskItem,
  TaskReward,
} from "../tasks.types";

export function TasksPage() {
  const [activeCategory, setActiveCategory] =
    useState<TaskCategoryFilter>("all");
  const [referralLink, setReferralLink] = useState<ReferralLink | null>(null);
  const [isReferralSheetOpen, setReferralSheetOpen] = useState(false);
  const { pushToast, showRewardModal } = useFeedback();
  const taskListQuery = useMemo(
    () => ({
      category: activeCategory,
    }),
    [activeCategory],
  );
  const taskQuery = useTasks(taskListQuery);
  const checkInQuery = useCheckInStatus();
  const bannerQuery = useBanners("task_top");
  const inviteStatsQuery = useInviteStats();
  const commissionQuery = useCommissionHistory();
  const claimTask = useClaimTask();
  const dailyCheckIn = useDailyCheckIn();
  const referralLinkMutation = useReferralLink();
  const inviteShare = useInviteShare();
  const claimCommission = useClaimCommission();
  const pendingTaskId = claimTask.isPending
    ? (claimTask.variables?.taskId ?? null)
    : null;
  const isRefreshing =
    taskQuery.isFetching ||
    checkInQuery.isFetching ||
    inviteStatsQuery.isFetching ||
    commissionQuery.isFetching;
  const isTaskCenterLoading = taskQuery.isLoading && !taskQuery.overview;

  function handleRefresh() {
    void taskQuery.refetch();
  }

  async function handleGenerateReferralLink() {
    try {
      const nextLink = await ensureReferralLink();
      setReferralSheetOpen(true);
      pushToast({
        type: "success",
        title: "邀请链接已生成",
        message: nextLink.referralCode,
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "生成失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function handleCopyReferralLink() {
    try {
      const link = await ensureReferralLink();
      await copyText(link.inviteUrl);
      await inviteShare.mutateAsync({
        scene: "TASK_PAGE",
        referralCode: link.referralCode,
      });
      pushToast({
        type: "success",
        title: "链接已复制",
        message: "分享任务进度已刷新。",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "复制失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function handleShareReferralLink() {
    try {
      const link = await ensureReferralLink();
      openTelegramShareLink({
        text: link.shareText,
        url: link.inviteUrl,
      });
      await inviteShare.mutateAsync({
        scene: "TASK_PAGE",
        referralCode: link.referralCode,
      });
      pushToast({
        type: "success",
        title: "分享已记录",
        message: "任务进度会以后端结果为准刷新。",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "分享失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function handleDailyCheckIn() {
    try {
      const campaignId = checkInQuery.checkInStatus?.campaign?.campaignId;
      const result = await dailyCheckIn.mutateAsync(
        campaignId ? { campaignId } : undefined,
      );

      if (result.alreadyClaimed) {
        pushToast({
          type: "info",
          title: "今日已签到",
          message: "签到状态已刷新。",
        });
        return;
      }

      showRewardModal({
        title: "签到成功",
        message: `连续签到 ${result.currentStreak} 天`,
        rewards: toRewardModalItems(result),
        confirmLabel: "收下",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "签到失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function handleClaimTask(task: TaskItem) {
    try {
      const result = await claimTask.mutateAsync({
        taskId: task.taskId,
        periodKey: task.periodKey,
      });

      showRewardModal({
        title: "任务奖励已领取",
        message: task.title,
        rewards: toRewardModalItems(result),
        confirmLabel: "收下",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "领取失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function handleClaimCommission() {
    try {
      const result = await claimCommission.mutateAsync(undefined);

      if (!result.claimed || result.claimedAmountKcoin <= 0) {
        pushToast({
          type: "info",
          title: "暂无可领取分红",
          message: "分红明细已刷新。",
        });
        return;
      }

      showRewardModal({
        title: "分红已领取",
        message: `${result.claimedCount} 笔分红已结算。`,
        rewards: toCommissionRewardModalItems(result),
        confirmLabel: "收下",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "分红领取失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  async function ensureReferralLink(): Promise<ReferralLink> {
    if (referralLink) {
      return referralLink;
    }

    const nextLink = await referralLinkMutation.mutateAsync({
      scene: "TASK_PAGE",
      source: "task_center",
    });
    setReferralLink(nextLink);
    return nextLink;
  }

  return (
    <section className="tasks-page" data-testid="tasks-page">
      <header className="tasks-page__header">
        <div>
          <span>成长系统</span>
          <h1>任务中心</h1>
        </div>
        <button
          aria-label="刷新任务中心"
          disabled={isRefreshing}
          onClick={handleRefresh}
          title="刷新任务中心"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={2.5} />
        </button>
      </header>

      <ActivityBanner banner={bannerQuery.primaryBanner} label="任务活动" />

      <InviteCampaignCard
        isGenerating={referralLinkMutation.isPending}
        isSharing={inviteShare.isPending}
        onCopy={() => void handleCopyReferralLink()}
        onGenerate={() => void handleGenerateReferralLink()}
        onShare={() => void handleShareReferralLink()}
        onShowLink={() => setReferralSheetOpen(true)}
        referralLink={referralLink}
      />

      <InviteStatsPanel stats={inviteStatsQuery.inviteStats} />

      <SevenDayCheckIn
        isPending={dailyCheckIn.isPending}
        onCheckIn={() => void handleDailyCheckIn()}
        status={checkInQuery.checkInStatus}
      />

      <TaskCategoryTabs
        activeCategory={activeCategory}
        onChange={setActiveCategory}
      />

      <TaskList
        error={taskQuery.error}
        isError={taskQuery.isError}
        isLoading={isTaskCenterLoading}
        onClaim={(task) => void handleClaimTask(task)}
        onRetry={() => void taskQuery.refetch()}
        pendingTaskId={pendingTaskId}
        tasks={taskQuery.tasks}
      />

      <CommissionStatsPanel
        history={commissionQuery.commissionHistory}
        isPending={claimCommission.isPending}
        onClaim={() => void handleClaimCommission()}
        stats={commissionQuery.commissionStats}
      />

      <RewardHistoryPanel
        checkInStatus={checkInQuery.checkInStatus}
        commissionHistory={commissionQuery.commissionHistory}
        isLoading={isTaskCenterLoading}
        tasks={taskQuery.allTasks}
      />

      <ReferralLinkSheet
        isPending={inviteShare.isPending}
        onClose={() => setReferralSheetOpen(false)}
        onCopy={() => void handleCopyReferralLink()}
        onShare={() => void handleShareReferralLink()}
        open={isReferralSheetOpen}
        referralLink={referralLink}
      />
    </section>
  );
}

async function copyText(text: string): Promise<void> {
  if (!globalThis.navigator?.clipboard?.writeText) {
    throw new Error("当前环境不支持复制。");
  }

  await globalThis.navigator.clipboard.writeText(text);
}

function toRewardModalItems(
  result: ClaimTaskResult | DailyCheckInResult,
): RewardModalItem[] {
  return result.rewards.map(toRewardModalItem);
}

function toRewardModalItem(reward: TaskReward): RewardModalItem {
  const item: RewardModalItem = {
    id: reward.id,
    label: reward.label,
    imageUrl: reward.iconUrl,
    tone: getRewardTone(reward),
  };

  if (reward.amount !== null) {
    item.amount = `+${reward.amount.toLocaleString("zh-CN")}`;
  }

  if (reward.detail) {
    item.detail = reward.detail;
  }

  return item;
}

function toCommissionRewardModalItems(
  result: ClaimCommissionResult,
): RewardModalItem[] {
  return [
    {
      id: "commission:kcoin",
      label: "KCOIN",
      amount: `+${result.claimedAmountKcoin.toLocaleString("zh-CN")}`,
      tone: "kcoin",
    },
  ];
}

function getRewardTone(
  reward: TaskReward,
): NonNullable<RewardModalItem["tone"]> {
  if (reward.currency === "KCOIN") {
    return "kcoin";
  }

  if (reward.currency === "FGEMS") {
    return "fgems";
  }

  if (reward.currency === "STAR_DISPLAY") {
    return "stars";
  }

  return "item";
}
