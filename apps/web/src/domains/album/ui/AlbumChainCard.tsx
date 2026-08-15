import { CircleHelp, Gift, LoaderCircle } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { chainTypeLabels, rarityLabels } from "../labels.ts";
import type { AlbumChain, AlbumNode } from "../types.ts";
import { t, tp } from "../../../platform/i18n/index.ts";

export function AlbumChainCard({
  chain,
  claimBlocked,
  claiming,
  onPrepareClaim,
  onClaim,
  onSelectNode,
}: {
  chain: AlbumChain;
  claimBlocked: boolean;
  claiming: boolean;
  onPrepareClaim(): void;
  onClaim(chainId: string): void;
  onSelectNode(
    chain: AlbumChain,
    node: AlbumNode,
    trigger: HTMLButtonElement,
  ): void;
}): ReactNode {
  const status = chain.claimed
    ? t("已领取")
    : chain.claimable
      ? t("可领取")
      : chain.unlocked_count === 0
        ? t("未开始")
        : t("收集中");
  return (
    <Card className={`album-chain-card chain-${chain.chain_type}`}>
      <header className="chain-head">
        <div>
          <Badge>{chainTypeLabels[chain.chain_type]}</Badge>
          <h2>{t(chain.theme)}</h2>
        </div>
        <div className="chain-progress">
          <strong>{chain.unlocked_count} / 3</strong>
          <span>{status}</span>
        </div>
      </header>
      <ol
        className="chain-nodes"
        aria-label={tp("{{0}}三阶节点", [t(chain.theme)])}
      >
        {chain.nodes.map((node) => (
          <li key={node.template_id}>
            <button
              type="button"
              className={`album-node ${node.unlocked ? "unlocked" : "locked"}`}
              aria-label={tp("{{0}}，第 {{1}} 阶，{{2}}，{{3}}", [
                t(node.name),
                node.stage,
                rarityLabels[node.rarity],
                node.unlocked
                  ? tp("已点亮，当前拥有 {{0}}", [node.owned_count])
                  : t("未点亮，查看获取方式"),
              ])}
              onClick={(event: MouseEvent<HTMLButtonElement>) =>
                onSelectNode(chain, node, event.currentTarget)
              }
            >
              <span className="album-node-art" aria-hidden="true">
                {node.unlocked ? (
                  <CatalogImage
                    url={node.image_thumbnail_url}
                    alt=""
                    variant="thumbnail"
                    loading="lazy"
                  />
                ) : (
                  <CircleHelp />
                )}
              </span>
              <span className="album-node-stage">
                {tp("第 {{0}} 阶", [node.stage])}
              </span>
              <strong>{t(node.name)}</strong>
              <small>{rarityLabels[node.rarity]}</small>
              <span className="album-node-owned">
                {node.unlocked
                  ? node.owned_count > 0
                    ? tp("当前拥有：{{0}}", [node.owned_count])
                    : t("已点亮")
                  : t("未点亮")}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Button
        className={`album-gift ${chain.claimable ? "claimable" : "secondary"}`}
        disabled={claimBlocked || !chain.claimable}
        aria-label={tp("{{0}}奖励，{{1}}，{{2}} Fgems", [
          t(chain.theme),
          claiming ? t("领取中") : status,
          chain.reward_fgems,
        ])}
        onPointerDown={onPrepareClaim}
        onFocus={onPrepareClaim}
        onClick={() => onClaim(chain.chain_id)}
      >
        {claiming ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <Gift aria-hidden="true" />
        )}
        <span>
          {claiming
            ? t("领取中")
            : chain.claimed
              ? t("已领取")
              : chain.claimable
                ? t("可领取")
                : t("未完成")}
          <small>{chain.reward_fgems} Fgems</small>
        </span>
      </Button>
    </Card>
  );
}
