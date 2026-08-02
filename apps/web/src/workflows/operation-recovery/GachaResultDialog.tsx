import type { CSSProperties, ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Button, CatalogImage } from "../../shared/ui/index.tsx";

type GachaResult = RouteOutput<"gacha.open">;
type ResultItem = GachaResult["results"][number];
type Rarity = ResultItem["rarity"];

const rarityRanks: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};
const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export function GachaResultDialog({
  result,
  busy,
  error,
  onRepeat,
  onInventory,
  onConfirm,
}: {
  result: GachaResult;
  busy: boolean;
  error: string | null;
  onRepeat(): void;
  onInventory(): void;
  onConfirm(): void;
}): ReactNode {
  const rankedResults = [...result.results].sort(
    (left, right) =>
      rarityRanks[right.rarity] - rarityRanks[left.rarity] ||
      left.order - right.order,
  );
  const single = result.draw_count === 1;

  return (
    <div
      className={`modal gacha-result-modal ${single ? "is-single" : "is-ten"}`}
    >
      <header className="gacha-result-heading">
        <small>PIXEL PARTY</small>
        <h2 id="gacha-result-title">{single ? "召唤结果" : "十连召唤"}</h2>
      </header>

      {single ? (
        <SingleResult item={rankedResults[0]!} />
      ) : (
        <TenDrawResults results={rankedResults} />
      )}

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

function SingleResult({ item }: { item: ResultItem }): ReactNode {
  return (
    <article className={`gacha-single-result rarity-${item.rarity}`}>
      <strong className="gacha-result-rarity">
        {rarityLabels[item.rarity]}
      </strong>
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
    </article>
  );
}

function TenDrawResults({ results }: { results: ResultItem[] }): ReactNode {
  return (
    <section className="gacha-ten-result" aria-label="十连召唤结果">
      <ol className="gacha-result-parade">
        {results.map((item, index) => (
          <li
            key={`${item.order}-${item.template_id}`}
            className={`rarity-${item.rarity}`}
            style={{ "--parade-index": index } as CSSProperties}
            aria-label={`${rarityLabels[item.rarity]}藏品：${item.name}，NEW`}
          >
            <strong className="gacha-result-rarity">
              {rarityLabels[item.rarity]}
            </strong>
            <div className="gacha-result-art">
              <CatalogImage
                path={item.image_detail_path}
                alt={item.name}
                variant="detail"
                loading="eager"
              />
              <span className="new-indicator">NEW</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
