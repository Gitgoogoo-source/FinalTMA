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
    const cost = count === 10 ? query.data?.ten_cost : query.data?.single_cost;
    const balance = identity.data?.assets.kcoin.available;
    if (cost !== undefined && balance !== undefined && balance < cost) {
      requestTopup({ kind: "wheel", count }, cost - balance);
      return;
    }
    void run("幸运转盘正在转动", "wheel.spin", { count });
  };
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
          <div className="wheel-disc">
            <RotateCw />
            <strong>{query.data?.remaining ?? 0}</strong>
            <span>今日剩余</span>
          </div>
          <div className="progress-line">
            <span>已转 {query.data?.spin_count ?? 0}</span>
            <span>今日上限 {query.data?.daily_limit ?? 20}</span>
          </div>
          <div className="button-row">
            <Button
              disabled={blocked || Number(query.data?.remaining) < 1}
              onClick={() => spin(1)}
            >
              转动 1 次 · {query.data?.single_cost ?? 20} K
            </Button>
            <Button
              className="secondary"
              disabled={blocked || Number(query.data?.remaining) < 10}
              onClick={() => spin(10)}
            >
              转动 10 次 · {query.data?.ten_cost ?? 180} K
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
