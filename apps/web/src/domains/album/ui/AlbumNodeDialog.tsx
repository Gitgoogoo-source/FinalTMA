import {
  CircleHelp,
  Dna,
  PackageSearch,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { Badge, Button } from "../../../shared/ui/index.tsx";
import { chainTypeLabels, rarityLabels } from "../labels.ts";
import type { AlbumChain, AlbumNode } from "../types.ts";

export function AlbumNodeDialog({
  chain,
  node,
  onClose,
  onPrepareNavigate,
  onNavigate,
}: {
  chain: AlbumChain;
  node: AlbumNode;
  onClose(): void;
  onPrepareNavigate(path: string): void;
  onNavigate(path: string): void;
}): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousNode = chain.nodes.find(
    (candidate) => candidate.stage === node.stage - 1,
  );
  const inventoryPath = `/inventory?template_id=${encodeURIComponent(node.template_id)}`;
  const marketPath = `/market?buy=${encodeURIComponent(node.template_id)}`;
  const gachaPath = `/?rarity=${node.rarity}`;
  const evolutionPath = previousNode
    ? `/inventory?template_id=${encodeURIComponent(previousNode.template_id)}&action=evolve`
    : null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="album-node-dialog"
      aria-labelledby="album-node-dialog-title"
      aria-describedby="album-node-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span>{node.unlocked ? "藏品详情" : "获取方式"}</span>
          <h2 id="album-node-dialog-title">{node.name}</h2>
        </div>
        <button
          type="button"
          className="album-dialog-close"
          aria-label="关闭弹窗"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div className={`album-dialog-art ${node.unlocked ? "" : "locked"}`}>
        {node.unlocked ? (
          <CatalogImage
            url={node.image_detail_url}
            alt={node.name}
            variant="detail"
            loading="eager"
            fetchPriority="high"
          />
        ) : (
          <CircleHelp aria-hidden="true" />
        )}
      </div>
      <div className="album-dialog-meta">
        <Badge>{chainTypeLabels[chain.chain_type]}</Badge>
        <Badge>{rarityLabels[node.rarity]}</Badge>
        <Badge>第 {node.stage} 阶</Badge>
      </div>
      <p id="album-node-dialog-description">所属链条：{chain.theme}</p>
      {node.unlocked ? (
        <>
          <div className="album-owned-summary" aria-live="polite">
            <span>
              图鉴状态<strong>已点亮</strong>
            </span>
            <span>
              当前拥有<strong>{node.owned_count}</strong>
            </span>
          </div>
          {node.owned_count === 0 && (
            <p>你曾经获得过该藏品，但当前库存为 0。</p>
          )}
          <Button
            onPointerEnter={() => onPrepareNavigate(inventoryPath)}
            onPointerDown={() => onPrepareNavigate(inventoryPath)}
            onFocus={() => onPrepareNavigate(inventoryPath)}
            onClick={() => onNavigate(inventoryPath)}
          >
            <PackageSearch aria-hidden="true" />
            去藏品查看
          </Button>
        </>
      ) : (
        <div className="album-acquisition-actions">
          <Button
            onPointerEnter={() => onPrepareNavigate(marketPath)}
            onPointerDown={() => onPrepareNavigate(marketPath)}
            onFocus={() => onPrepareNavigate(marketPath)}
            onClick={() => onNavigate(marketPath)}
          >
            <ShoppingBag aria-hidden="true" />
            去交易市场购买
          </Button>
          <Button
            onPointerEnter={() => onPrepareNavigate(gachaPath)}
            onPointerDown={() => onPrepareNavigate(gachaPath)}
            onFocus={() => onPrepareNavigate(gachaPath)}
            onClick={() => onNavigate(gachaPath)}
          >
            <Sparkles aria-hidden="true" />
            去开盲盒
          </Button>
          {node.stage > 1 && evolutionPath && (
            <Button
              onPointerEnter={() => onPrepareNavigate(evolutionPath)}
              onPointerDown={() => onPrepareNavigate(evolutionPath)}
              onFocus={() => onPrepareNavigate(evolutionPath)}
              onClick={() => onNavigate(evolutionPath)}
            >
              <Dna aria-hidden="true" />
              去进化
            </Button>
          )}
        </div>
      )}
    </dialog>
  );
}
