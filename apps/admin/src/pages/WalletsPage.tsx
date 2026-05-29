import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchWallets } from "../admin.api";
import type { WalletsResponse } from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

export function WalletsPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<WalletsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(
        await fetchWallets({
          q: query || undefined,
          limit: 30,
        }),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "钱包数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>地址 / 钱包 ID</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="TON address 或 UUID"
            value={query}
          />
        </label>
        <button
          className="icon-button"
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        {Object.entries(data?.summary ?? {}).map(([key, value]) => (
          <span key={key}>
            <strong>{value}</strong>
            <small>{key}</small>
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>钱包</th>
              <th>用户</th>
              <th>网络</th>
              <th>状态</th>
              <th>Proof</th>
              <th>同步</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((wallet) => (
              <tr key={wallet.id}>
                <td>
                  <strong>{shortId(wallet.id)}</strong>
                  <small>{wallet.address}</small>
                </td>
                <td>{shortId(wallet.user_id)}</td>
                <td>{wallet.network}</td>
                <td>
                  <StatusBadge
                    status={
                      wallet.status === "connected" && wallet.verified_at
                        ? "verified"
                        : wallet.status
                    }
                  />
                  <small>{formatDate(wallet.verified_at)}</small>
                </td>
                <td>
                  {wallet.latest_proof ? (
                    <>
                      <StatusBadge status={wallet.latest_proof.status} />
                      <small>{wallet.latest_proof.domain ?? "-"}</small>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{formatDate(wallet.last_sync_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
