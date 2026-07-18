import { RotateCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { text } from "../../shared/lib/data.ts";
import { Button, Card } from "../../shared/ui/index.tsx";

export function WheelPanel(): ReactNode {
  const query = useApiQuery("wheel.bootstrap");
  const { blocked, run } = useOperation();
  const spin = (count: 1 | 10) =>
    void run("幸运转盘正在转动", async () => {
      const response = await apiRequest(
        "wheel.spin",
        { count },
        { idempotencyKey: newIdempotencyKey() },
      );
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <Card className="game-panel wheel">
      <div className="panel-title">
        <Sparkles />
        <div>
          <span>LUCKY WHEEL</span>
          <h2>幸运转盘</h2>
        </div>
      </div>
      {query.isLoading ? (
        <p>正在读取今日次数</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>重新加载转盘</Button>
      ) : (
        <>
          <div className="wheel-disc">
            <RotateCw />
            <strong>{text(query.data?.remaining)}</strong>
            <span>今日剩余</span>
          </div>
          <div className="progress-line">
            <span>已转 {text(query.data?.spin_count)}</span>
            <span>今日上限 {text(query.data?.daily_limit)}</span>
          </div>
          <div className="button-row">
            <Button
              disabled={blocked || Number(query.data?.remaining) < 1}
              onClick={() => spin(1)}
            >
              转动 1 次 · {text(query.data?.single_cost)} K
            </Button>
            <Button
              className="secondary"
              disabled={blocked || Number(query.data?.remaining) < 10}
              onClick={() => spin(10)}
            >
              转动 10 次 · {text(query.data?.ten_cost)} K
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
