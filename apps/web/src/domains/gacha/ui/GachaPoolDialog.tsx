import type { RouteOutput } from "@pokepets/api-contracts/app";
import { AlertTriangle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, CatalogImage } from "../../../shared/ui/index.tsx";

type BoxTier = "normal" | "rare" | "legendary";
type PoolRarity = RouteOutput<"gacha.pool">["rarities"][number];

const rarityLabels = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const;
const probabilityFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 6,
});

export function GachaPoolDialog({
  tier,
  close,
}: {
  tier: BoxTier;
  close(): void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const query = useApiQuery("gacha.pool", { tier });
  const empty = query.data?.rarities.length === 0;

  useEffect(() => {
    const current = dialog.current;
    if (current && !current.open) current.showModal();
    return () => {
      if (current?.open) current.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="gacha-pool-dialog"
      aria-labelledby="gacha-pool-title"
      aria-describedby="gacha-pool-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <span>当前档次奖池</span>
          <h2 id="gacha-pool-title">
            {query.data?.display_name ?? "可能获得"}
          </h2>
        </div>
        <button
          type="button"
          className="gacha-pool-close"
          aria-label="关闭可能获得弹窗"
          autoFocus
          onClick={close}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <p id="gacha-pool-description" className="gacha-pool-description">
        仅展示当前盲盒基础概率大于 0 的全部正式藏品模板。
      </p>

      {query.isPending || (query.isFetching && !query.data) ? (
        <div className="gacha-pool-state" role="status" aria-live="polite">
          <RefreshCw className="spin" aria-hidden="true" />
          <strong>正在加载真实奖池</strong>
          <span>目录确认前不会展示临时候选或概率</span>
        </div>
      ) : query.error || empty ? (
        <div className="gacha-pool-state error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <strong>奖池加载失败，请重试</strong>
          <span>当前档次的正式目录或规则尚未完整确认</span>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            {query.isFetching ? "正在重试" : "重试"}
          </Button>
        </div>
      ) : query.data ? (
        <>
          <div className="gacha-pool-pity">
            <ShieldCheck aria-hidden="true" />
            <span>当前付费保底目标</span>
            <strong>
              第 {query.data.pity.limit} 抽必得
              {rarityLabels[query.data.pity.target_rarity]}或以上藏品
            </strong>
          </div>
          <div className="gacha-pool-groups">
            {query.data.rarities.map((rarity) => (
              <PoolRarityGroup key={rarity.rarity} rarity={rarity} />
            ))}
          </div>
          <footer>
            <span>正式目录 {query.data.catalog_version}</span>
            <Button className="secondary" onClick={close}>
              关闭
            </Button>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}

function PoolRarityGroup({ rarity }: { rarity: PoolRarity }): ReactNode {
  return (
    <section className={`gacha-pool-group rarity-${rarity.rarity}`}>
      <header>
        <div>
          <i aria-hidden="true" />
          <h3>{rarityLabels[rarity.rarity]}</h3>
        </div>
        <strong>{formatProbability(rarity.rarity_probability_percent)}%</strong>
      </header>
      <div className="gacha-pool-items">
        {rarity.items.map((item) => (
          <article key={item.template_id} className="gacha-pool-item">
            <CatalogImage
              path={item.image_thumbnail_path}
              alt={item.name}
              variant="thumbnail"
              loading="lazy"
            />
            <div className="gacha-pool-item-copy">
              <strong>{item.name}</strong>
              <span>
                {rarityLabels[item.rarity]} · 第 {item.stage} 阶
              </span>
              <dl>
                <div>
                  <dt>该档稀有度概率</dt>
                  <dd>
                    {formatProbability(rarity.rarity_probability_percent)}%
                  </dd>
                </div>
                <div>
                  <dt>目录基础权重</dt>
                  <dd>
                    {item.catalog_weight} / {rarity.catalog_total_weight}
                  </dd>
                </div>
                <div>
                  <dt>单模板概率</dt>
                  <dd>{formatProbability(item.single_probability_percent)}%</dd>
                </div>
              </dl>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatProbability(value: number): string {
  return probabilityFormatter.format(value);
}
