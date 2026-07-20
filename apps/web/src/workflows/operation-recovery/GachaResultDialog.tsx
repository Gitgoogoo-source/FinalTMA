import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Button, CatalogImage } from "../../shared/ui/index.tsx";

type GachaResult = RouteOutput<"gacha.open">;
type Rarity = GachaResult["results"][number]["rarity"];

const rarityOrder = [
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const satisfies readonly Rarity[];
const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const tierLabels: Record<GachaResult["tier"], string> = {
  normal: "普通盲盒",
  rare: "稀有盲盒",
  legendary: "传说盲盒",
};

export function GachaResultDialog({
  operationId,
  result,
  busy,
  error,
  onRepeat,
  onInventory,
  onConfirm,
}: {
  operationId: string;
  result: GachaResult;
  busy: boolean;
  error: string | null;
  onRepeat(): void;
  onInventory(): void;
  onConfirm(): void;
}): ReactNode {
  const orderedResults = [...result.results].sort(
    (left, right) => left.order - right.order,
  );
  const pityPositions = orderedResults
    .filter((item) => item.pity_triggered)
    .map((item) => `第 ${item.order} 抽`);
  const cost = result.entitlement_used
    ? `${result.entitlement_used === "free_normal_box" ? "免费普通" : "免费稀有"}盲盒资格 ×1`
    : `${result.paid_kcoin} K-coin`;

  return (
    <div className="modal gacha-result-modal">
      <header className="gacha-result-heading">
        <span className="gacha-result-mark" aria-hidden="true">
          <Sparkles />
        </span>
        <div>
          <small>{tierLabels[result.tier]}</small>
          <h2 id="gacha-result-title">
            {result.draw_count === 1 ? "恭喜获得" : "十连开盒结果"}
          </h2>
        </div>
      </header>

      {result.draw_count === 1 ? (
        <SingleResult item={orderedResults[0]!} />
      ) : (
        <TenDrawResults results={orderedResults} />
      )}

      <dl className="result-summary gacha-result-summary">
        <div>
          <dt>实际消耗</dt>
          <dd>{cost}</dd>
        </div>
        <div>
          <dt>保底触发</dt>
          <dd>
            {pityPositions.length ? pityPositions.join("、") : "本次未触发"}
          </dd>
        </div>
        <div>
          <dt>最新保底</dt>
          <dd>
            {result.pity.progress} / {result.pity.limit} · 目标
            {rarityLabels[result.pity.target_rarity]}
          </dd>
        </div>
      </dl>

      <code className="gacha-operation-id">操作号 {operationId}</code>
      {error ? <p className="operation-ack-error">{error}</p> : null}
      <div className="gacha-result-actions">
        <Button disabled={busy} onClick={onRepeat}>
          {busy ? "正在确认结果" : "再开一次"}
        </Button>
        <Button className="secondary" disabled={busy} onClick={onInventory}>
          去藏品查看
        </Button>
        <Button className="secondary" disabled={busy} onClick={onConfirm}>
          确定
        </Button>
      </div>
    </div>
  );
}

function SingleResult({
  item,
}: {
  item: GachaResult["results"][number];
}): ReactNode {
  return (
    <article className={`gacha-single-result rarity-${item.rarity}`}>
      <div className="gacha-result-art">
        <CatalogImage
          path={item.image_detail_path}
          alt={item.name}
          variant="detail"
          loading="eager"
          fetchPriority="high"
        />
        <span className="new-indicator">NEW</span>
      </div>
      <div className="gacha-result-copy">
        <strong>{item.name}</strong>
        <span>
          {rarityLabels[item.rarity]} · 第 {item.stage} 阶
        </span>
        <small>数量 ×{item.quantity}</small>
        {item.pity_triggered ? (
          <em className="pity-triggered">触发保底</em>
        ) : null}
      </div>
    </article>
  );
}

function TenDrawResults({
  results,
}: {
  results: GachaResult["results"];
}): ReactNode {
  const summary = rarityOrder.map((rarity) => ({
    rarity,
    quantity: results
      .filter((item) => item.rarity === rarity)
      .reduce((total, item) => total + item.quantity, 0),
  }));
  return (
    <div className="gacha-ten-result">
      <section className="gacha-rarity-summary" aria-label="稀有度数量汇总">
        {summary.map(({ rarity, quantity }) => (
          <span key={rarity} className={`rarity-${rarity}`}>
            {rarityLabels[rarity]}
            <strong>×{quantity}</strong>
          </span>
        ))}
      </section>
      <ol className="gacha-result-list" aria-label="十连有序结果">
        {results.map((item) => (
          <li key={`${item.order}-${item.template_id}`}>
            <span className="gacha-result-order">{item.order}</span>
            <CatalogImage
              path={item.image_thumbnail_path}
              alt={item.name}
              variant="thumbnail"
              loading="eager"
            />
            <div>
              <strong>{item.name}</strong>
              <span>
                {rarityLabels[item.rarity]} · 第 {item.stage} 阶 · 数量 ×
                {item.quantity}
              </span>
              <small>
                <b className="new-indicator">NEW</b>
                {item.pity_triggered ? (
                  <em className="pity-triggered">触发保底</em>
                ) : null}
              </small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
