import { ChevronLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { useApiQuery } from "../../../platform/query/index.ts";
import { useTelegramBackButton } from "../../../platform/telegram/index.ts";
import { Badge, Button, PageState } from "../../../shared/ui/index.tsx";
import {
  useBlockingOperationRecovery,
  useOperationRegistry,
} from "../../../workflows/operation-recovery/index.ts";
import type { AlbumChain, AlbumFilter, AlbumNode } from "../types.ts";
import { AlbumChainCard } from "./AlbumChainCard.tsx";
import { AlbumNodeDialog } from "./AlbumNodeDialog.tsx";

const filters: readonly { id: AlbumFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "normal", label: "普通链" },
  { id: "advanced", label: "高级链" },
  { id: "top", label: "顶级链" },
  { id: "claimable", label: "可领取" },
  { id: "incomplete", label: "未完成" },
];

export function AlbumView(): ReactNode {
  const query = useApiQuery("album.get");
  const bootstrap = useApiQuery("identity.bootstrap");
  useBlockingOperationRecovery(bootstrap.data?.blocking_operations);
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBackButton(true, back);
  const { isBlocked, run } = useOperationRegistry();
  const blocked = isBlocked("album.claim");
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
    void run("正在领取图鉴奖励", "album.claim", { chain_id: chainId });
  };
  return (
    <main className="page fullscreen album-page">
      <header className="page-heading album-heading">
        <Button className="icon-only" aria-label="返回" onClick={back}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div>
          <span>ALBUM</span>
          <h1>进化图鉴</h1>
        </div>
        <Badge>{query.isFetching ? "正在刷新" : "真实进度"}</Badge>
      </header>
      <PageState
        loading={query.isLoading}
        error={query.error as Error | null}
        onRetry={() => void query.refetch()}
        empty={chains.length === 0}
      >
        {query.data && (
          <>
            <section className="album-overview" aria-label="图鉴总览">
              <div>
                <span>已点亮</span>
                <strong>
                  {query.data.unlocked_count} / {query.data.total_count}
                </strong>
              </div>
              <div>
                <span>完成链</span>
                <strong>
                  {query.data.completed_chain_count} /{" "}
                  {query.data.total_chain_count}
                </strong>
              </div>
              <div>
                <span>可领取</span>
                <strong>{query.data.claimable_count}</strong>
              </div>
            </section>
            <div className="album-filters" role="group" aria-label="图鉴筛选">
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
              当前显示 {visibleChains.length} 条链
            </p>
            {visibleChains.length > 0 ? (
              <div className="album-list">
                {visibleChains.map((chain) => (
                  <AlbumChainCard
                    key={chain.chain_id}
                    chain={chain}
                    claimBlocked={blocked}
                    claiming={claimingChainId === chain.chain_id}
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
                当前筛选下没有图鉴链
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
          onNavigate={(path) => {
            setDialog(null);
            navigate(path);
          }}
        />
      )}
    </main>
  );
}
