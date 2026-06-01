import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchMarketListingDetail } from "../admin.api";
import type { MarketListingAdminDetail } from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

export function MarketOpsPage() {
  const [listingId, setListingId] = useState(readListingIdFromHash);
  const [data, setData] = useState<MarketListingAdminDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [error, setError] = useState<string | null>(null);

  async function load(nextListingId = listingId) {
    if (!nextListingId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchMarketListingDetail(nextListingId);
      setData(response);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error ? loadError.message : "市场挂单加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(listingId);
  }, [listingId]);

  useEffect(() => {
    function syncListingIdFromHash() {
      setListingId(readListingIdFromHash());
    }

    window.addEventListener("hashchange", syncListingIdFromHash);

    return () =>
      window.removeEventListener("hashchange", syncListingIdFromHash);
  }, []);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>挂单 ID</span>
          <input
            onChange={(event) => setListingId(event.target.value.trim())}
            placeholder="market.listings.id"
            value={listingId}
          />
        </label>
        <button
          className="icon-button"
          disabled={!listingId || loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          <span>刷新</span>
        </button>
      </div>

      {!listingId ? <p className="notice">暂无挂单 ID。</p> : null}
      {error ? <p className="notice notice--error">{error}</p> : null}
      {loading ? <p className="notice">正在加载市场挂单...</p> : null}

      {data ? <MarketListingDetail detail={data} /> : null}
    </section>
  );
}

function MarketListingDetail({ detail }: { detail: MarketListingAdminDetail }) {
  return (
    <>
      <section className="detail-panel">
        <div className="detail-panel__header">
          <div>
            <p>市场挂单</p>
            <h2>{shortId(detail.id)}</h2>
          </div>
          <StatusBadge status={detail.status} />
        </div>
        <div className="detail-grid detail-grid--wide">
          <DetailItem label="挂单 ID" value={detail.id} />
          <DetailItem label="模板" value={formatTemplate(detail)} />
          <DetailItem label="形态" value={formatForm(detail)} />
          <DetailItem label="稀有度" value={detail.rarityCode} />
          <DetailItem
            label="数量"
            value={`${detail.remainingCount}/${detail.itemCount}`}
          />
          <DetailItem
            label="单价 Kcoin"
            value={String(detail.unitPriceKcoin)}
          />
          <DetailItem label="手续费 bps" value={String(detail.feeBps)} />
          <DetailItem
            label="预估净入账"
            value={String(detail.expectedNetAmount)}
          />
          <DetailItem label="价格健康" value={detail.priceHealth ?? "-"} />
          <DetailItem
            label="到期"
            value={formatDate(detail.expiresAt ?? null)}
          />
          <DetailItem label="创建" value={formatDate(detail.createdAt)} />
          <DetailItem label="更新" value={formatDate(detail.updatedAt)} />
        </div>
      </section>

      <div className="split-grid">
        <section className="ops-card">
          <header>
            <div>
              <p>Listing items</p>
              <h3>锁定资产</h3>
            </div>
            <StatusBadge status={`${detail.items.length}`} />
          </header>
          <div className="stack-list stack-list--spaced">
            {detail.items.length > 0 ? (
              detail.items.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{shortId(item.itemInstanceId)}</strong>
                    <small>
                      level {item.level ?? "-"} / power {item.power ?? "-"}
                    </small>
                  </div>
                  <div className="list-row__actions">
                    <StatusBadge status={item.status} />
                    {item.itemStatus ? (
                      <StatusBadge status={item.itemStatus} />
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="notice">没有挂单资产记录。</p>
            )}
          </div>
        </section>

        <section className="ops-card">
          <header>
            <div>
              <p>Orders</p>
              <h3>成交记录</h3>
            </div>
            <StatusBadge status={`${detail.orders.length}`} />
          </header>
          <div className="stack-list stack-list--spaced">
            {detail.orders.length > 0 ? (
              detail.orders.map((order) => (
                <div className="list-row" key={order.id}>
                  <div>
                    <strong>{shortId(order.id)}</strong>
                    <small>
                      {order.itemCount} 件 / {String(order.totalPriceKcoin)}{" "}
                      Kcoin
                    </small>
                  </div>
                  <div className="list-row__actions">
                    <StatusBadge status={order.status} />
                    <small>{formatDate(order.createdAt ?? null)}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="notice">没有成交记录。</p>
            )}
          </div>
        </section>
      </div>

      <section className="ops-card">
        <header>
          <div>
            <p>Events</p>
            <h3>挂单事件</h3>
          </div>
          <a
            className="icon-button"
            href={`#audit?targetSchema=market&targetTable=listings&targetId=${encodeURIComponent(detail.id)}`}
          >
            <ExternalLink aria-hidden="true" size={15} />
            <span>审计</span>
          </a>
        </header>
        <div className="stack-list stack-list--spaced">
          {detail.events.length > 0 ? (
            detail.events.map((event) => (
              <div className="list-row" key={event.id}>
                <div>
                  <strong>{event.eventType}</strong>
                  <small>{shortId(event.id)}</small>
                </div>
                <small>{formatDate(event.createdAt ?? null)}</small>
              </div>
            ))
          ) : (
            <p className="notice">没有挂单事件。</p>
          )}
        </div>
      </section>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTemplate(detail: MarketListingAdminDetail): string {
  if (!detail.template) {
    return shortId(detail.templateId);
  }

  return `${detail.template.displayName} / ${shortId(detail.template.id)}`;
}

function formatForm(detail: MarketListingAdminDetail): string {
  if (!detail.form) {
    return detail.formId ? shortId(detail.formId) : "-";
  }

  return `${detail.form.displayName} / ${shortId(detail.form.id)}`;
}

function readListingIdFromHash(): string {
  const query = window.location.hash.split("?")[1] ?? "";

  return new URLSearchParams(query).get("listingId")?.trim() ?? "";
}
