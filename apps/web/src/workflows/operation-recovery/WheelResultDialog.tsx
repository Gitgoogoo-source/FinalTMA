import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Button } from "../../shared/ui/index.tsx";

type WheelResult = RouteOutput<"wheel.spin">;
type WheelReward = WheelResult["rewards"][number];

const rewardKindLabels: Record<WheelReward["kind"], string> = {
  fgems: "Fgems",
  kcoin: "K-coin",
  free_normal_box: "免费普通盲盒资格",
  free_rare_box: "免费稀有盲盒资格",
};
const replacedKindLabels: Record<
  NonNullable<WheelReward["replaced_kind"]>,
  string
> = {
  free_normal_box: "免费普通盲盒资格",
  free_rare_box: "免费稀有盲盒资格",
};

export function WheelResultDialog({
  operationId,
  result,
  busy,
  error,
  onConfirm,
}: {
  operationId: string;
  result: WheelResult;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
}): ReactNode {
  const rewards = [...result.rewards].sort(
    (left, right) => left.order - right.order,
  );
  const summary = rewardSummary(result);
  return (
    <div className="modal wheel-result-modal">
      <header className="wheel-result-heading">
        <span className="wheel-result-mark" aria-hidden="true">
          <Sparkles />
        </span>
        <div>
          <small>幸运转盘 · 已由服务器确认</small>
          <h2 id="wheel-result-title">
            {result.count === 1 ? "本次转盘结果" : "十次转盘结果"}
          </h2>
        </div>
      </header>

      <ol
        className="wheel-result-list"
        aria-label={`${result.count} 次有序奖励`}
      >
        {rewards.map((reward) => (
          <li key={`${reward.order}-${reward.kind}`}>
            <span>{reward.order}</span>
            <div>
              <strong>{rewardLabel(reward)}</strong>
              {reward.replaced_kind ? (
                <small>{`命中${replacedKindLabels[reward.replaced_kind]}，已达今日实得上限，实际替换为 ${reward.amount} Fgems`}</small>
              ) : (
                <small>第 {reward.order} 次确定奖励</small>
              )}
            </div>
          </li>
        ))}
      </ol>

      <dl className="result-summary wheel-result-summary">
        <div>
          <dt>奖励汇总</dt>
          <dd>{summary}</dd>
        </div>
        <div>
          <dt>本次扣款</dt>
          <dd>−{result.cost_kcoin} K-coin</dd>
        </div>
        <div>
          <dt>K-coin 奖励返入</dt>
          <dd>+{result.kcoin_returned} K-coin</dd>
        </div>
        <div>
          <dt>K-coin 净变化</dt>
          <dd
            className={
              result.net_kcoin_change > 0
                ? "positive"
                : result.net_kcoin_change < 0
                  ? "negative"
                  : undefined
            }
          >
            {signed(result.net_kcoin_change)} K-coin
          </dd>
        </div>
        <div>
          <dt>里程碑奖励</dt>
          <dd>
            {result.milestone.awarded_fgems > 0
              ? `+${result.milestone.awarded_fgems} Fgems`
              : "本次未触发"}
            {` · 10 次${result.milestone.milestone_10_claimed ? "已获得" : "未获得"} · 20 次${result.milestone.milestone_20_claimed ? "已获得" : "未获得"}`}
          </dd>
        </div>
        <div>
          <dt>免费资格</dt>
          <dd>
            普通 {result.entitlements.free_normal_box} 次（本次 +
            {result.reward_summary.free_normal_box}） · 稀有{" "}
            {result.entitlements.free_rare_box}
            次（本次 +{result.reward_summary.free_rare_box}）
          </dd>
        </div>
        <div>
          <dt>今日次数</dt>
          <dd>
            {result.spin_count} / {result.daily_limit} 次 · 剩余{" "}
            {result.remaining} 次
          </dd>
        </div>
        <div>
          <dt>最终资产</dt>
          <dd>
            K-coin {result.assets.kcoin.available} · Fgems{" "}
            {result.assets.fgems.available}
          </dd>
        </div>
      </dl>

      <code className="wheel-operation-id">操作号 {operationId}</code>
      {error ? <p className="operation-ack-error">{error}</p> : null}
      <Button disabled={busy} onClick={onConfirm}>
        {busy ? "正在确认结果" : "确认结果"}
      </Button>
    </div>
  );
}

function rewardLabel(reward: WheelReward): string {
  return reward.kind === "free_normal_box" || reward.kind === "free_rare_box"
    ? `${rewardKindLabels[reward.kind]} ×${reward.amount}`
    : `${reward.amount} ${rewardKindLabels[reward.kind]}`;
}

function rewardSummary(result: WheelResult): string {
  const summary = result.reward_summary;
  const parts = [
    summary.fgems ? `${summary.fgems} Fgems` : null,
    summary.kcoin ? `${summary.kcoin} K-coin` : null,
    summary.free_normal_box ? `免费普通资格 ×${summary.free_normal_box}` : null,
    summary.free_rare_box ? `免费稀有资格 ×${summary.free_rare_box}` : null,
    summary.replaced_free_normal_box
      ? `普通资格替换 ×${summary.replaced_free_normal_box}`
      : null,
    summary.replaced_free_rare_box
      ? `稀有资格替换 ×${summary.replaced_free_rare_box}`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
