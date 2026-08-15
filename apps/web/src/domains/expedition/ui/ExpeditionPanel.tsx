import { Compass, Timer } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppSearchParams } from "../../../platform/navigation/index.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { localized, t, tp } from "../../../platform/i18n/index.ts";

const tierNames = localized({
  normal: "普通",
  intermediate: "中级",
  advanced: "高级",
} as const);
const rarityNames: Record<string, string> = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
});
type Tier = keyof typeof tierNames;

export function ExpeditionPanel(): ReactNode {
  const [params] = useAppSearchParams();
  const query = useApiQuery("expedition.list");
  const refetchExpeditions = query.refetch;
  const { run } = useOperationCommands();
  const createBlocked = useOperationBlocked("expedition.create");
  const claimBlocked = useOperationBlocked("expedition.claim");
  const blocked = createBlocked || claimBlocked;
  const [selectionTier, setSelectionTier] = useState<Tier | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const grid = useRef<HTMLDivElement>(null);
  const eligible = useApiQuery(
    "expedition.eligible_items",
    { tier: selectionTier ?? "normal" },
    selectionTier !== null,
  );
  const active = query.data?.active ?? [];
  const rules = query.data?.rules;
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
  useEffect(() => {
    const focus = params.get("focus");
    const tier = focus?.startsWith("expedition-")
      ? focus.slice("expedition-".length)
      : null;
    if (!isTier(tier)) return;
    return focusTaskTarget(
      grid.current?.querySelector<HTMLElement>(
        `[data-expedition-tier="${tier}"]`,
      ) ?? null,
    );
  }, [params, rules]);

  const create = () => {
    if (!selectionTier) return;
    void run(t("正在创建远征"), "expedition.create", {
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
    void run(t("正在领取远征奖励"), "expedition.claim", {
      expedition_id: expeditionId,
    });

  return (
    <Card className="game-panel">
      <div className="panel-title">
        <Compass />
        <div>
          <span>EXPEDITION</span>
          <h2>{t("藏品远征")}</h2>
        </div>
      </div>
      {query.isLoading ? (
        <p>{t("正在加载远征状态")}</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>
          {t("重新加载远征")}
        </Button>
      ) : (
        <div ref={grid} className="expedition-grid">
          {(rules ?? []).map((rule) => {
            const tier = rule.tier;
            const running = active.find((item) => item.tier === tier);
            const isReady = running?.status === "claimable";
            return (
              <Card key={tier} className={`expedition-card ${tier}`}>
                <div
                  className="expedition-route"
                  data-expedition-tier={tier}
                  tabIndex={-1}
                >
                  <span className="route-icon">
                    <Compass aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{tp("{{0}}远征", [tierNames[tier]])}</strong>
                    <small>
                      {rule.allowed_rarities
                        .map((rarity) => rarityNames[rarity] ?? rarity)
                        .join(" · ")}
                    </small>
                  </div>
                  <span className="route-count">
                    {usedToday[tier]}/{rule.daily_limit}
                  </span>
                </div>
                <span>{tp("{{0}} 分钟完成", [rule.duration_minutes])}</span>
                {running ? (
                  <div className="active-expedition">
                    <Timer />
                    <div>
                      <strong>{isReady ? t("待领取") : t("远征中")}</strong>
                      <small>{running.completes_at}</small>
                    </div>
                    <Button
                      disabled={blocked || !isReady}
                      onClick={() => claim(running.id)}
                    >
                      {tp("领取 {{0}} Fgems", [running.reward_fgems])}
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
                    {t("开始远征")}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {selectionTier && (
        <AppModal
          labelledBy="expedition-picker-title"
          onClose={blocked ? undefined : () => setSelectionTier(null)}
        >
          <div className="modal expedition-picker">
            <h2 id="expedition-picker-title">
              {tp("选择{{0}}远征藏品", [tierNames[selectionTier]])}
            </h2>
            <p>{t("请选择正好 3 个当前可用的藏品单位。")}</p>
            {eligible.isLoading ? (
              <p>{t("正在加载可派遣藏品")}</p>
            ) : eligible.error ? (
              <Button onClick={() => void eligible.refetch()}>
                {t("重新加载")}
              </Button>
            ) : (
              <div className="selection-list">
                {items.map((item) => {
                  const id = item.template_id;
                  const count = selection[id] ?? 0;
                  return (
                    <Card key={id} className={count ? "selected" : ""}>
                      <CatalogImage
                        url={item.image_thumbnail_url}
                        alt={t(item.name)}
                        variant="thumbnail"
                        loading="lazy"
                      />
                      <div>
                        <strong>{t(item.name)}</strong>
                        <small>
                          {tp("{{0}} · 第 {{1}} 阶 · {{2}} Fgems", [
                            item.rarity,
                            item.stage,
                            item.unit_reward_fgems,
                          ])}
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
            <strong>{tp("预计奖励：{{0}} Fgems", [expectedReward])}</strong>
            <div className="button-row">
              <Button
                className="secondary"
                disabled={blocked}
                onClick={() => setSelectionTier(null)}
              >
                {t("取消")}
              </Button>
              <Button
                disabled={blocked || eligible.isLoading || selectedCount !== 3}
                onClick={create}
              >
                {t("开始远征")}
              </Button>
            </div>
          </div>
        </AppModal>
      )}
    </Card>
  );
}

function isTier(value: string | null): value is Tier {
  return value === "normal" || value === "intermediate" || value === "advanced";
}
