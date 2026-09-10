import { Compass, Timer, X, Plus } from "lucide-react";
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
import {
  localized,
  t,
  tp,
  tr,
  formatDate,
} from "../../../platform/i18n/index.ts";

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
                      <small>
                        {formatDate(running.completes_at, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                    <Button
                      disabled={blocked || !isReady}
                      onClick={() => claim(running.id)}
                    >
                      {claimBlocked
                        ? t("领取中")
                        : tp("领取 {{0}} Gems", [running.reward_fgems])}
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
          className="expedition-picker-backdrop"
          labelledBy="expedition-picker-title"
          onClose={blocked ? undefined : () => setSelectionTier(null)}
        >
          <div className="modal expedition-picker">
            <header className="expedition-picker-heading">
              <span className="dialog-kicker">
                <Compass aria-hidden="true" />
                {tr("A NEW ADVENTURE", "新的冒险")}
              </span>
              <h2 id="expedition-picker-title">
                {tp("{{0}}远征小队", [tierNames[selectionTier]])}
              </h2>
              <p>
                {tr(
                  "Choose 3 companions for the journey.",
                  "选择 3 位伙伴，一起出发。",
                )}
              </p>
              <button
                type="button"
                className="dialog-close"
                disabled={blocked}
                onClick={() => setSelectionTier(null)}
                aria-label={t("关闭")}
              >
                <X />
              </button>
            </header>
            <div
              className="expedition-team-preview"
              aria-label={tp("已选择 {{0}} / 3", [selectedCount])}
            >
              {Array.from({ length: 3 }, (_, index) => {
                const selected = items.flatMap((item) =>
                  Array.from(
                    { length: Math.min(3, selection[item.template_id] ?? 0) },
                    () => item,
                  ),
                )[index];
                return (
                  <div key={index} className={selected ? "filled" : ""}>
                    {selected ? (
                      <CatalogImage
                        url={selected.image_thumbnail_url}
                        alt={t(selected.name)}
                        variant="thumbnail"
                        loading="eager"
                      />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    <small>
                      {selected
                        ? t(selected.name)
                        : tp("伙伴 {{0}}", [index + 1])}
                    </small>
                  </div>
                );
              })}
            </div>
            <div className="expedition-picker-content">
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
                            {tp("{{0}} · 第 {{1}} 阶 · {{2}} Gems", [
                              rarityNames[item.rarity] ?? item.rarity,
                              item.stage,
                              item.unit_reward_fgems,
                            ])}
                          </small>
                        </div>
                        <Button
                          disabled={blocked || count === 0}
                          aria-label={tp("减少{{0}}", [t(item.name)])}
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
                          {count}/{item.available}
                        </Badge>
                        <Button
                          disabled={
                            blocked ||
                            selectedCount >= 3 ||
                            count >= item.available
                          }
                          aria-label={tp("增加{{0}}", [t(item.name)])}
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
            </div>
            <footer className="expedition-picker-footer">
              <div className="expedition-trip-summary">
                <span>
                  <Timer aria-hidden="true" />
                  {tp("{{0}} 分钟", [
                    rules?.find((rule) => rule.tier === selectionTier)
                      ?.duration_minutes ?? "—",
                  ])}
                </span>
                <strong>{tp("预计奖励：{{0}} Gems", [expectedReward])}</strong>
              </div>
              <div className="button-row">
                <Button
                  className="secondary"
                  disabled={blocked}
                  onClick={() => setSelectionTier(null)}
                >
                  {t("取消")}
                </Button>
                <Button
                  disabled={
                    blocked || eligible.isLoading || selectedCount !== 3
                  }
                  onClick={create}
                >
                  {createBlocked ? t("出发中") : t("开始远征")}
                </Button>
              </div>
            </footer>
          </div>
        </AppModal>
      )}
    </Card>
  );
}

function isTier(value: string | null): value is Tier {
  return value === "normal" || value === "intermediate" || value === "advanced";
}
