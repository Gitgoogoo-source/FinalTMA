import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import type { RewardModalItem } from "@/features/feedback/feedback.types";

import { AlbumGrid } from "../components/AlbumGrid";
import { AlbumProgress } from "../components/AlbumProgress";
import { AlbumSeriesTabs } from "../components/AlbumSeriesTabs";
import { MilestoneRewardRow } from "../components/MilestoneRewardRow";
import { useClaimAlbumReward } from "../hooks/useClaimAlbumReward";
import { useAlbumProgress } from "../hooks/useAlbumProgress";
import { useAlbumSeries } from "../hooks/useAlbumSeries";
import type {
  AlbumClaimRewardResponse,
  AlbumMilestone,
  AlbumProgressQuery,
  AlbumReward,
} from "../album.types";

export function AlbumPage() {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const { pushToast, showRewardModal } = useFeedback();
  const albumSeriesQuery = useAlbumSeries();
  const progressQuery = useMemo(() => {
    const query: AlbumProgressQuery = {
      includeItems: true,
      includeMilestones: true,
      includeRewards: true,
      includeLockedItems: true,
    };

    if (selectedBookId) {
      query.bookId = selectedBookId;
    }

    return query;
  }, [selectedBookId]);
  const albumProgressQuery = useAlbumProgress(progressQuery);
  const claimReward = useClaimAlbumReward();
  const progress = albumProgressQuery.progress;
  const isRefreshing =
    albumProgressQuery.isFetching || albumSeriesQuery.isFetching;
  const pendingMilestoneId = claimReward.isPending
    ? (claimReward.variables?.milestoneId ?? null)
    : null;

  function handleRefresh() {
    void albumSeriesQuery.refetch();
    void albumProgressQuery.refetch();
  }

  async function handleClaimMilestone(milestone: AlbumMilestone) {
    try {
      const result = await claimReward.mutateAsync({
        milestoneId: milestone.milestoneId,
        bookId: milestone.bookId,
        expectedMilestoneVersion: milestone.version,
      });

      showRewardModal({
        title: "图鉴奖励已领取",
        message: "图鉴进度和资产余额已刷新。",
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

  if (albumProgressQuery.isLoading && !progress) {
    return (
      <section className="album-page album-page--state" aria-busy="true">
        <div className="album-state">
          <span className="album-state__spinner" />
          <strong>图鉴加载中</strong>
        </div>
      </section>
    );
  }

  if (albumProgressQuery.isError && !progress) {
    return (
      <section className="album-page album-page--state">
        <div className="album-state" role="alert">
          <strong>图鉴读取失败</strong>
          <span>{getApiErrorMessage(albumProgressQuery.error)}</span>
          <button
            onClick={() => void albumProgressQuery.refetch()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!progress) {
    return (
      <section className="album-page album-page--state">
        <div className="album-state">
          <strong>图鉴暂不可用</strong>
          <span>登录完成后会自动读取图鉴进度。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="album-page" data-testid="album-page">
      <header className="album-page__header">
        <div>
          <span>成长系统</span>
          <h1>图鉴</h1>
        </div>
        <button
          aria-label="刷新图鉴进度"
          disabled={isRefreshing}
          onClick={handleRefresh}
          title="刷新图鉴进度"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={2.4} />
        </button>
      </header>

      <AlbumSeriesTabs
        books={albumSeriesQuery.books}
        error={albumSeriesQuery.error}
        isError={albumSeriesQuery.isError}
        isLoading={albumSeriesQuery.isLoading}
        onRetry={() => void albumSeriesQuery.refetch()}
        onSelectBook={setSelectedBookId}
        selectedBookId={selectedBookId}
      />

      <AlbumProgress progress={progress} />

      <section
        className="album-milestones"
        aria-labelledby="album-milestones-title"
      >
        <header className="album-milestones__header">
          <div>
            <span>图鉴奖励</span>
            <h2 id="album-milestones-title">里程碑奖励</h2>
          </div>
          <strong>{progress.milestones.length}</strong>
        </header>

        {progress.milestones.length > 0 && progress.book ? (
          <div className="album-milestones__list">
            {progress.milestones.map((milestone) => (
              <MilestoneRewardRow
                collectedCount={progress.book?.collectedCount ?? 0}
                isPending={pendingMilestoneId === milestone.milestoneId}
                key={milestone.milestoneId}
                milestone={milestone}
                onClaim={(nextMilestone) =>
                  void handleClaimMilestone(nextMilestone)
                }
                totalCount={progress.book?.totalCount ?? 0}
              />
            ))}
          </div>
        ) : (
          <div className="album-milestones__empty">
            <strong>暂无里程碑奖励</strong>
            <span>当前图鉴册还没有配置可领取的奖励。</span>
          </div>
        )}
      </section>

      <AlbumGrid items={progress.items} />
    </section>
  );
}

function toRewardModalItems(
  result: AlbumClaimRewardResponse,
): RewardModalItem[] {
  return result.rewards.map((reward, index) => {
    const item: RewardModalItem = {
      id: `${reward.rewardType}:${reward.templateId ?? index}`,
      label: reward.label,
      imageUrl: reward.iconUrl,
      tone: getRewardTone(reward.rewardType),
    };
    const detail = getRewardDetail(reward);

    if (reward.amount !== null) {
      item.amount = `+${formatRewardAmount(reward.amount)}`;
    }

    if (detail) {
      item.detail = detail;
    }

    return item;
  });
}

function getRewardDetail(reward: AlbumReward): string | undefined {
  if (reward.templateId) {
    return "图鉴奖励道具";
  }

  return undefined;
}

function getRewardTone(
  rewardType: string,
): NonNullable<RewardModalItem["tone"]> {
  const normalized = rewardType.toUpperCase();

  if (normalized === "KCOIN") {
    return "kcoin";
  }

  if (normalized === "FGEMS") {
    return "fgems";
  }

  if (normalized === "STAR_DISPLAY") {
    return "stars";
  }

  return "item";
}

function formatRewardAmount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
