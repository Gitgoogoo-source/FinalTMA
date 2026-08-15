import {
  CircleHelp,
  Dna,
  PackageSearch,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { chainTypeLabels, rarityLabels } from "../labels.ts";
import type { AlbumChain, AlbumNode } from "../types.ts";
import { t, tp } from "../../../platform/i18n/index.ts";

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
          <span>{node.unlocked ? t("藏品详情") : t("获取方式")}</span>
          <h2 id="album-node-dialog-title">{t(node.name)}</h2>
        </div>
        <button
          type="button"
          className="album-dialog-close"
          aria-label={t("关闭弹窗")}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div className={`album-dialog-art ${node.unlocked ? "" : "locked"}`}>
        {node.unlocked ? (
          <CatalogImage
            url={node.image_detail_url}
            alt={t(node.name)}
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
        <Badge>{tp("第 {{0}} 阶", [node.stage])}</Badge>
      </div>
      <p id="album-node-dialog-description">
        {tp("所属链条：{{0}}", [t(chain.theme)])}
      </p>
      {node.unlocked ? (
        <>
          <div className="album-owned-summary" aria-live="polite">
            <span>
              {t("图鉴状态")}
              <strong>{t("已点亮")}</strong>
            </span>
            <span>
              {t("当前拥有")}
              <strong>{node.owned_count}</strong>
            </span>
          </div>
          {node.owned_count === 0 && (
            <p>{t("你曾经获得过该藏品，但当前库存为 0。")}</p>
          )}
          <Button
            onPointerEnter={() => onPrepareNavigate(inventoryPath)}
            onPointerDown={() => onPrepareNavigate(inventoryPath)}
            onFocus={() => onPrepareNavigate(inventoryPath)}
            onClick={() => onNavigate(inventoryPath)}
          >
            <PackageSearch aria-hidden="true" />
            {t("去藏品查看")}
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
            {t("去交易市场购买")}
          </Button>
          <Button
            onPointerEnter={() => onPrepareNavigate(gachaPath)}
            onPointerDown={() => onPrepareNavigate(gachaPath)}
            onFocus={() => onPrepareNavigate(gachaPath)}
            onClick={() => onNavigate(gachaPath)}
          >
            <Sparkles aria-hidden="true" />
            {t("去开盲盒")}
          </Button>
          {node.stage > 1 && evolutionPath && (
            <Button
              onPointerEnter={() => onPrepareNavigate(evolutionPath)}
              onPointerDown={() => onPrepareNavigate(evolutionPath)}
              onFocus={() => onPrepareNavigate(evolutionPath)}
              onClick={() => onNavigate(evolutionPath)}
            >
              <Dna aria-hidden="true" />
              {t("去进化")}
            </Button>
          )}
        </div>
      )}
    </dialog>
  );
}
