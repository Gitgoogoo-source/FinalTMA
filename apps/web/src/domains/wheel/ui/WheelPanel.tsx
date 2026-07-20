import { RotateCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, Card } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";

export function WheelPanel(): ReactNode {
  const query = useApiQuery("wheel.get");
  const identity = useApiQuery("identity.bootstrap");
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("wheel.spin");
  const [params, setParams] = useSearchParams();
  const resumedCount =
    params.get("resume") && params.get("count") === "10"
      ? 10
      : params.get("resume")
        ? 1
        : null;
  const spin = (count: 1 | 10) => {
    if (blocked) return;
    const cost = count === 10 ? query.data?.ten_cost : query.data?.single_cost;
    const balance = identity.data?.assets.kcoin.available;
    if (cost !== undefined && balance !== undefined && balance < cost) {
      requestTopup({ kind: "wheel", count }, cost - balance);
      return;
    }
    void run("幸运转盘正在转动", "wheel.spin", { count });
  };
  const remaining = query.data?.remaining ?? 0;
  return (
    <Card className="game-panel wheel">
      <div className="panel-title">
        <Sparkles />
        <div>
          <span>LUCKY WHEEL</span>
          <h2>幸运转盘</h2>
        </div>
      </div>
      {resumedCount && (
        <div className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原转盘选择，将按当前余额与今日次数重新确认，不会自动转动。
          </p>
          <Button
            disabled={blocked}
            onClick={() => {
              setParams({});
              spin(resumedCount);
            }}
          >
            重新确认转动 {resumedCount} 次
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <p>正在读取今日次数</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>重新加载转盘</Button>
      ) : (
        <>
          <div
            className={`wheel-disc${blocked ? " spinning" : ""}`}
            aria-busy={blocked}
          >
            <RotateCw />
            <strong>{blocked ? "…" : remaining}</strong>
            <span aria-live="polite">
              {blocked ? "结果确认中" : "今日剩余"}
            </span>
          </div>
          <div className="progress-line">
            <span>已转 {query.data?.spin_count ?? 0}</span>
            <span>今日上限 {query.data?.daily_limit ?? 20}</span>
          </div>
          <div className="wheel-progress-track" aria-hidden="true">
            <i
              style={{
                width: `${Math.min(
                  100,
                  ((query.data?.spin_count ?? 0) /
                    Math.max(1, query.data?.daily_limit ?? 20)) *
                    100,
                )}%`,
              }}
            />
          </div>
          <div className="wheel-milestones">
            <span className={query.data?.milestone_10_claimed ? "claimed" : ""}>
              <i>10</i>
              +25 Fgems
            </span>
            <span className={query.data?.milestone_20_claimed ? "claimed" : ""}>
              <i>20</i>
              +25 Fgems
            </span>
          </div>
          <div className="button-row">
            <Button disabled={blocked || remaining < 1} onClick={() => spin(1)}>
              {blocked
                ? "转动中..."
                : remaining < 1
                  ? "今日次数已用完"
                  : `转动 1 次 · ${query.data?.single_cost ?? 20} K-coin`}
            </Button>
            <Button
              className="secondary"
              disabled={blocked || remaining < 10}
              onClick={() => spin(10)}
            >
              {blocked
                ? "转动中..."
                : remaining < 10
                  ? "剩余次数不足"
                  : `转动 10 次 · ${query.data?.ten_cost ?? 180} K-coin`}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
