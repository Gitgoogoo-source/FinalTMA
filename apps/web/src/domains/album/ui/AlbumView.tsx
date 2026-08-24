import { ChevronLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAppNavigate } from "../../../platform/navigation/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useIdentityRecovery } from "../../../platform/session/store.ts";
import { usePageModulePreparation } from "../../../shared/navigation/pageModulePreparation.ts";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { useBlockingOperationRecovery } from "../../../workflows/operation-recovery/useBlockingOperationRecovery.ts";
import type { AlbumChain, AlbumFilter, AlbumNode } from "../types.ts";
import { AlbumChainCard } from "./AlbumChainCard.tsx";
import { AlbumNodeDialog } from "./AlbumNodeDialog.tsx";
import { localized, t, tp } from "../../../platform/i18n/index.ts";

const filters: readonly { id: AlbumFilter; label: string }[] = localized([
  { id: "all", label: "全部" },
  { id: "normal", label: "普通链" },
  { id: "advanced", label: "高级链" },
  { id: "top", label: "顶级链" },
  { id: "claimable", label: "可领取" },
  { id: "incomplete", label: "未完成" },
]);

export function AlbumView(): ReactNode {
  const query = useApiQuery("album.get");
  const recovery = useIdentityRecovery();
  useBlockingOperationRecovery(recovery?.blocking_operations);
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  const back = useCallback(() => navigate(-1), [navigate]);
  const { preload, run } = useOperationCommands();
  const blocked = useOperationBlocked("album.claim");
  const [filter, setFilter] = useState<AlbumFilter>("all");
  const [claimingChainId, setClaimingChainId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    chain: AlbumChain;
    node: AlbumNode;
  } | null>(null);
  const claimObserved = useRef(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const chains = useMemo(() => query.data?.chains ?? [], [query.data?.chains]);
  const visibleChains = useMemo(
    () =>
      chains.filter((chain) => {
        if (filter === "all") return true;
        if (filter === "claimable") return chain.claimable;
        if (filter === "incomplete") return !chain.completed;
        return chain.chain_type === filter;
      }),
    [chains, filter],
  );
  useEffect(() => {
    if (!claimingChainId) return;
    if (blocked) claimObserved.current = true;
    else if (claimObserved.current) {
      claimObserved.current = false;
      setClaimingChainId(null);
    }
  }, [blocked, claimingChainId]);
  const closeDialog = () => {
    setDialog(null);
    requestAnimationFrame(() => dialogTrigger.current?.focus());
  };
  const claim = (chainId: string) => {
    if (blocked) return;
    claimObserved.current = false;
    setClaimingChainId(chainId);
    void run(t("正在领取图鉴奖励"), "album.claim", { chain_id: chainId });
  };
  return (
    <main className="page fullscreen album-page">
      <header className="page-heading album-heading">
        <img
          className="album-heading-art"
          src="/assets/album/washi-fox-header.webp"
          alt=""
          aria-hidden="true"
        />
        <Button className="icon-only" aria-label={t("返回")} onClick={back}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div>
          <span>ALBUM</span>
          <h1>{t("进化图鉴")}</h1>
        </div>
        {query.isFetching ? <Badge>{t("正在刷新")}</Badge> : null}
      </header>
      <PageState
        loading={query.isLoading}
        error={query.error as Error | null}
        onRetry={() => void query.refetch()}
        empty={chains.length === 0}
      >
        {query.data && (
          <>
            <section className="album-overview" aria-label={t("图鉴总览")}>
              <div>
                <span>{t("已点亮")}</span>
                <strong>
                  <b>{query.data.unlocked_count}</b>
                  <small>/ {query.data.total_count}</small>
                </strong>
              </div>
              <div>
                <span>{t("完成链")}</span>
                <strong>
                  <b>{query.data.completed_chain_count}</b>
                  <small>/ {query.data.total_chain_count}</small>
                </strong>
              </div>
              <div>
                <span>{t("可领取")}</span>
                <strong>
                  <b>{query.data.claimable_count}</b>
                </strong>
              </div>
            </section>
            <div
              className="album-filters"
              role="group"
              aria-label={t("图鉴筛选")}
            >
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? "active" : ""}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="album-filter-summary" role="status">
              {tp("当前显示 {{0}} 条链", [visibleChains.length])}
            </p>
            {visibleChains.length > 0 ? (
              <div className="album-list">
                {visibleChains.map((chain) => (
                  <AlbumChainCard
                    key={chain.chain_id}
                    chain={chain}
                    claimBlocked={blocked}
                    claiming={claimingChainId === chain.chain_id}
                    onPrepareClaim={() => preload("album.claim")}
                    onClaim={claim}
                    onSelectNode={(selectedChain, node, trigger) => {
                      dialogTrigger.current = trigger;
                      setDialog({ chain: selectedChain, node });
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="album-filter-empty" role="status">
                {t("当前筛选下没有图鉴链")}
              </div>
            )}
          </>
        )}
      </PageState>
      {dialog && (
        <AlbumNodeDialog
          chain={dialog.chain}
          node={dialog.node}
          onClose={closeDialog}
          onPrepareNavigate={preparePage}
          onNavigate={(path) => {
            setDialog(null);
            preparePage(path);
            navigate(path);
          }}
        />
      )}
    </main>
  );
}
