import { Compass, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CatalogImage } from "../../catalog/index.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

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
  const query = useApiQuery("expedition.list");
  const refetchExpeditions = query.refetch;
  const { isBlocked, run } = useOperationRegistry();
  const blocked =
    isBlocked("expedition.create") || isBlocked("expedition.claim");
  const [selectionTier, setSelectionTier] = useState<Tier | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const eligible = useApiQuery(
    "expedition.eligible_items",
    { tier: selectionTier ?? "normal" },
    selectionTier !== null,
  );
  const active = query.data?.active ?? [];
  const rules = query.data?.rules ?? [];
  const usedToday = query.data?.used_today ?? {
    normal: 0,
    intermediate: 0,
    advanced: 0,
  };
  const items = eligible.data?.items ?? [];
  const selectedCount = Object.values(selection).reduce(
    (sum, value) => sum + value,
    0,
  );
  const expectedReward = items.reduce(
    (sum, item) =>
      sum + item.unit_reward_fgems * (selection[item.template_id] ?? 0),
    0,
  );
  useEffect(() => {
    const timer = window.setInterval(() => void refetchExpeditions(), 30_000);
    return () => window.clearInterval(timer);
  }, [refetchExpeditions]);

  const create = () => {
    if (!selectionTier) return;
    void run("正在创建远征", "expedition.create", {
      tier: selectionTier,
      items: Object.entries(selection)
        .filter(([, quantity]) => quantity > 0)
        .map(([template_id, quantity]) => ({ template_id, quantity })),
    }).then((result) => {
      if (!result) return;
      setSelectionTier(null);
      setSelection({});
    });
  };
  const claim = (expeditionId: string) =>
    void run("正在领取远征奖励", "expedition.claim", {
      expedition_id: expeditionId,
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
            const tier = rule.tier;
            const running = active.find((item) => item.tier === tier);
            const isReady = running?.status === "claimable";
            return (
              <Card key={tier} className="expedition-card">
                <strong>{tierNames[tier]}远征</strong>
                <small>
                  {rule.allowed_rarities
                    .map((rarity) => rarityNames[rarity] ?? rarity)
                    .join(" · ")}
                </small>
                <span>
                  {rule.duration_minutes} 分钟 · 今日 {usedToday[tier]}/
                  {rule.daily_limit}
                </span>
                {running ? (
                  <div className="active-expedition">
                    <Timer />
                    <div>
                      <strong>{isReady ? "待领取" : "远征中"}</strong>
                      <small>{running.completes_at}</small>
                    </div>
                    <Button
                      disabled={blocked || !isReady}
                      onClick={() => claim(running.id)}
                    >
                      领取 {running.reward_fgems} Fgems
                    </Button>
                  </div>
                ) : (
                  <Button
                    disabled={blocked || usedToday[tier] >= rule.daily_limit}
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
                  const id = item.template_id;
                  const count = selection[id] ?? 0;
                  return (
                    <Card key={id} className={count ? "selected" : ""}>
                      <CatalogImage path={item.image_path} alt={item.name} />
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.rarity} · 第 {item.stage} 阶 ·{" "}
                          {item.unit_reward_fgems} Fgems
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
                        {count} / {item.available}
                      </Badge>
                      <Button
                        disabled={selectedCount >= 3 || count >= item.available}
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
