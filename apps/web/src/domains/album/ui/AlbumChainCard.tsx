import { CircleHelp, Gift, LoaderCircle } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { Badge, Button, Card } from "../../../shared/ui/index.tsx";
import { chainTypeLabels, rarityLabels } from "../labels.ts";
import type { AlbumChain, AlbumNode } from "../types.ts";

export function AlbumChainCard({
  chain,
  claimBlocked,
  claiming,
  onClaim,
  onSelectNode,
}: {
  chain: AlbumChain;
  claimBlocked: boolean;
  claiming: boolean;
  onClaim(chainId: string): void;
  onSelectNode(
    chain: AlbumChain,
    node: AlbumNode,
    trigger: HTMLButtonElement,
  ): void;
}): ReactNode {
  const status = chain.claimed
    ? "已领取"
    : chain.claimable
      ? "可领取"
      : chain.unlocked_count === 0
        ? "未开始"
        : "收集中";
  return (
    <Card className={`album-chain-card chain-${chain.chain_type}`}>
      <header className="chain-head">
        <div>
          <Badge>{chainTypeLabels[chain.chain_type]}</Badge>
          <h2>{chain.theme}</h2>
        </div>
        <div className="chain-progress">
          <strong>{chain.unlocked_count} / 3</strong>
          <span>{status}</span>
        </div>
      </header>
      <ol className="chain-nodes" aria-label={`${chain.theme}三阶节点`}>
        {chain.nodes.map((node) => (
          <li key={node.template_id}>
            <button
              type="button"
              className={`album-node ${node.unlocked ? "unlocked" : "locked"}`}
              aria-label={`${node.name}，第 ${node.stage} 阶，${rarityLabels[node.rarity]}，${node.unlocked ? `已点亮，当前拥有 ${node.owned_count}` : "未点亮，查看获取方式"}`}
              onClick={(event: MouseEvent<HTMLButtonElement>) =>
                onSelectNode(chain, node, event.currentTarget)
              }
            >
              <span className="album-node-art" aria-hidden="true">
                {node.unlocked ? (
                  <CatalogImage
                    path={node.image_thumbnail_path}
                    alt=""
                    variant="thumbnail"
                    loading="lazy"
                  />
                ) : (
                  <CircleHelp />
                )}
              </span>
              <span className="album-node-stage">第 {node.stage} 阶</span>
              <strong>{node.name}</strong>
              <small>{rarityLabels[node.rarity]}</small>
              <span className="album-node-owned">
                {node.unlocked
                  ? node.owned_count > 0
                    ? `当前拥有：${node.owned_count}`
                    : "已点亮"
                  : "未点亮"}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Button
        className={`album-gift ${chain.claimable ? "claimable" : "secondary"}`}
        disabled={claimBlocked || !chain.claimable}
        aria-label={`${chain.theme}奖励，${claiming ? "领取中" : status}，${chain.reward_fgems} Fgems`}
        onClick={() => onClaim(chain.chain_id)}
      >
        {claiming ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <Gift aria-hidden="true" />
        )}
        <span>
          {claiming
            ? "领取中"
            : chain.claimed
              ? "已领取"
              : chain.claimable
                ? "可领取"
                : "未完成"}
          <small>{chain.reward_fgems} Fgems</small>
        </span>
      </Button>
    </Card>
  );
}
