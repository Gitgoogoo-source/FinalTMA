import { Compass, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { child, number, records, text } from "../../shared/lib/data.ts";
import { Badge, Button, Card, CatalogImage } from "../../shared/ui/index.tsx";

const tierNames = {
  normal: "普通",
  intermediate: "中级",
  advanced: "高级",
} as const;
const rarityNames: Record<string, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
type Tier = keyof typeof tierNames;

export function ExpeditionPanel(): ReactNode {
  const query = useApiQuery("expeditions.bootstrap");
  const refetchExpeditions = query.refetch;
  const { blocked, run } = useOperation();
  const [selectionTier, setSelectionTier] = useState<Tier | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const eligible = useApiQuery(
    "expeditions.eligible_items",
    selectionTier ? { tier: selectionTier } : {},
    selectionTier !== null,
  );
  const active = records(query.data?.active);
  const rules = records(query.data?.rules);
  const usedToday = child(query.data, "used_today");
  const items = records(eligible.data?.items);
  const selectedCount = Object.values(selection).reduce(
    (sum, value) => sum + value,
    0,
  );
  const expectedReward = items.reduce(
    (sum, item) =>
      sum +
      number(item.unit_reward_fgems) * (selection[text(item.template_id)] ?? 0),
    0,
  );
  useEffect(() => {
    const timer = window.setInterval(() => void refetchExpeditions(), 30_000);
    return () => window.clearInterval(timer);
  }, [refetchExpeditions]);

  const create = () => {
    if (!selectionTier) return;
    void run("正在创建远征", async () => {
      const response = await apiRequest(
        "expeditions.create",
        {
          tier: selectionTier,
          items: Object.entries(selection)
            .filter(([, quantity]) => quantity > 0)
            .map(([template_id, quantity]) => ({ template_id, quantity })),
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSelectionTier(null);
      setSelection({});
      return { data: response.data, operationId: response.operationId };
    });
  };
  const claim = (expeditionId: unknown) =>
    void run("正在领取远征奖励", async () => {
      const response = await apiRequest(
        "expeditions.claim",
        { expedition_id: expeditionId },
        { idempotencyKey: newIdempotencyKey() },
      );
      return { data: response.data, operationId: response.operationId };
    });

  return (
    <Card className="game-panel">
      <div className="panel-title">
        <Compass />
        <div>
          <span>EXPEDITION</span>
          <h2>藏品远征</h2>
        </div>
      </div>
      {query.isLoading ? (
        <p>正在加载远征状态</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>重新加载远征</Button>
      ) : (
        <div className="expedition-grid">
          {rules.map((rule) => {
            const tier = text(rule.tier) as Tier;
            const running = active.find((item) => item.tier === tier);
            const isReady = running?.status === "claimable";
            return (
              <Card key={tier} className="expedition-card">
                <strong>{tierNames[tier]}远征</strong>
                <small>
                  {Array.isArray(rule.rarities)
                    ? rule.rarities
                        .map(
                          (rarity) => rarityNames[text(rarity)] ?? text(rarity),
                        )
                        .join(" · ")
                    : ""}
                </small>
                <span>
                  {text(rule.duration_minutes)} 分钟 · 今日{" "}
                  {text(usedToday[tier])}/{text(rule.daily_limit)}
                </span>
                {running ? (
                  <div className="active-expedition">
                    <Timer />
                    <div>
                      <strong>{isReady ? "待领取" : "远征中"}</strong>
                      <small>{text(running.completes_at)}</small>
                    </div>
                    <Button
                      disabled={blocked || !isReady}
                      onClick={() => claim(running.id)}
                    >
                      领取 {text(running.reward_fgems)} Fgems
                    </Button>
                  </div>
                ) : (
                  <Button
                    disabled={
                      blocked ||
                      number(usedToday[tier]) >= number(rule.daily_limit)
                    }
                    onClick={() => {
                      setSelection({});
                      setSelectionTier(tier);
                    }}
                  >
                    开始远征
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {selectionTier && (
        <div className="modal-backdrop">
          <div className="modal expedition-picker">
            <h2>选择{tierNames[selectionTier]}远征藏品</h2>
            <p>请选择正好 3 个当前可用的藏品单位。</p>
            {eligible.isLoading ? (
              <p>正在读取可派遣藏品</p>
            ) : eligible.error ? (
              <Button onClick={() => void eligible.refetch()}>重新加载</Button>
            ) : (
              <div className="selection-list">
                {items.map((item) => {
                  const id = text(item.template_id);
                  const count = selection[id] ?? 0;
                  return (
                    <Card key={id} className={count ? "selected" : ""}>
                      <CatalogImage
                        path={item.image_path}
                        alt={text(item.name)}
                      />
                      <div>
                        <strong>{text(item.name)}</strong>
                        <small>
                          {text(item.rarity)} · 第 {text(item.stage)} 阶 ·{" "}
                          {text(item.unit_reward_fgems)} Fgems
                        </small>
                      </div>
                      <Button
                        disabled={count === 0}
                        onClick={() =>
                          setSelection((value) => ({
                            ...value,
                            [id]: count - 1,
                          }))
                        }
                      >
                        −
                      </Button>
                      <Badge>
                        {count} / {text(item.available)}
                      </Badge>
                      <Button
                        disabled={
                          selectedCount >= 3 || count >= number(item.available)
                        }
                        onClick={() =>
                          setSelection((value) => ({
                            ...value,
                            [id]: count + 1,
                          }))
                        }
                      >
                        ＋
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
            <strong>预计奖励：{expectedReward} Fgems</strong>
            <div className="button-row">
              <Button
                className="secondary"
                disabled={blocked}
                onClick={() => setSelectionTier(null)}
              >
                取消
              </Button>
              <Button
                disabled={blocked || eligible.isLoading || selectedCount !== 3}
                onClick={create}
              >
                开始远征
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
