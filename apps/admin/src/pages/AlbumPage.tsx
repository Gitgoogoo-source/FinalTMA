import { RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchAlbumAdmin, updateAlbumMilestone } from "../admin.api";
import type {
  AlbumAdminResponse,
  AlbumBookAdminItem,
  AlbumMilestoneAdminItem,
  UpdateAlbumMilestoneInput,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

const BOOK_TYPES = ["", "all", "series", "faction", "rarity", "event"];

type MilestoneDraft = {
  id: string;
  title: string;
  required_count: string;
  reward: string;
  active: boolean;
  sort_order: string;
  metadata: string;
};

export function AlbumPage({
  canWriteCatalog = false,
}: {
  canWriteCatalog?: boolean;
}) {
  const [bookType, setBookType] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AlbumAdminResponse | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<MilestoneDraft | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const books = data?.items ?? [];
  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? books[0] ?? null,
    [books, selectedBookId],
  );
  const selectedMilestone = useMemo(
    () =>
      selectedBook?.milestones.find(
        (milestone) => milestone.id === selectedMilestoneId,
      ) ??
      selectedBook?.milestones[0] ??
      null,
    [selectedBook, selectedMilestoneId],
  );

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAlbumAdmin({
        book_type: bookType || undefined,
        q: query || undefined,
        limit: 50,
      });

      setData(response);
      setSelectedBookId((current) =>
        current && response.items.some((book) => book.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(readError(loadError, "图鉴配置加载失败"));
      setData(null);
      setSelectedBookId(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!draft) {
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError("保存图鉴奖励必须填写 reason");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await updateAlbumMilestone(serializeDraft(draft, operationReason));
      setNotice("图鉴里程碑奖励已保存，审计日志已写入。");
      await load();
    } catch (saveError) {
      setError(readError(saveError, "保存图鉴奖励失败"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selectedMilestone) {
      setDraft(toDraft(selectedMilestone));
    } else {
      setDraft(null);
    }
  }, [selectedMilestone]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>图鉴类型</span>
          <select
            value={bookType}
            onChange={(event) => setBookType(event.target.value)}
          >
            {BOOK_TYPES.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>搜索</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="code / 名称"
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
      {notice ? <p className="notice notice--success">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="admin-split">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>图鉴</th>
                <th>类型</th>
                <th>藏品数</th>
                <th>里程碑</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => (
                <BookRow
                  book={book}
                  key={book.id}
                  selected={selectedBook?.id === book.id}
                  onSelect={() => {
                    setSelectedBookId(book.id);
                    setSelectedMilestoneId(book.milestones[0]?.id ?? null);
                  }}
                />
              ))}
              {books.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6}>暂无图鉴配置</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <aside className="detail-panel">
          {selectedBook ? (
            <>
              <header>
                <div>
                  <p>Book {shortId(selectedBook.id)}</p>
                  <h2>{selectedBook.display_name}</h2>
                </div>
                <StatusBadge
                  status={selectedBook.active ? "active" : "inactive"}
                />
              </header>
              <div className="table-wrap table-wrap--compact">
                <table>
                  <thead>
                    <tr>
                      <th>门槛</th>
                      <th>标题</th>
                      <th>奖励</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBook.milestones.map((milestone) => (
                      <tr
                        className={
                          selectedMilestone?.id === milestone.id
                            ? "is-selected"
                            : ""
                        }
                        key={milestone.id}
                      >
                        <td>{milestone.required_count}</td>
                        <td>{milestone.title}</td>
                        <td>{formatReward(milestone.reward)}</td>
                        <td>
                          <StatusBadge
                            status={milestone.active ? "active" : "inactive"}
                          />
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            onClick={() => setSelectedMilestoneId(milestone.id)}
                            type="button"
                          >
                            选择
                          </button>
                        </td>
                      </tr>
                    ))}
                    {selectedBook.milestones.length === 0 ? (
                      <tr>
                        <td colSpan={5}>暂无里程碑</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {draft ? (
                <>
                  <div className="form-grid">
                    <label>
                      <span>标题</span>
                      <input
                        disabled={!canWriteCatalog || saving}
                        value={draft.title}
                        onChange={(event) =>
                          setDraft({ ...draft, title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>门槛</span>
                      <input
                        disabled={!canWriteCatalog || saving}
                        inputMode="numeric"
                        value={draft.required_count}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            required_count: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>排序</span>
                      <input
                        disabled={!canWriteCatalog || saving}
                        inputMode="numeric"
                        value={draft.sort_order}
                        onChange={(event) =>
                          setDraft({ ...draft, sort_order: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>启用</span>
                      <input
                        checked={draft.active}
                        disabled={!canWriteCatalog || saving}
                        onChange={(event) =>
                          setDraft({ ...draft, active: event.target.checked })
                        }
                        type="checkbox"
                      />
                    </label>
                  </div>
                  <label className="field-stack">
                    <span>Reward JSON</span>
                    <textarea
                      disabled={!canWriteCatalog || saving}
                      rows={5}
                      value={draft.reward}
                      onChange={(event) =>
                        setDraft({ ...draft, reward: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-stack">
                    <span>Metadata JSON</span>
                    <textarea
                      disabled={!canWriteCatalog || saving}
                      rows={5}
                      value={draft.metadata}
                      onChange={(event) =>
                        setDraft({ ...draft, metadata: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-stack">
                    <span>Reason</span>
                    <input
                      disabled={!canWriteCatalog || saving}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="说明本次奖励配置原因"
                    />
                  </label>
                  <button
                    className="icon-button"
                    disabled={!canWriteCatalog || saving}
                    onClick={() => void save()}
                    type="button"
                  >
                    <Save aria-hidden="true" size={17} />
                    <span>{saving ? "保存中" : "保存奖励"}</span>
                  </button>
                </>
              ) : (
                <p className="notice">请选择一个里程碑</p>
              )}
            </>
          ) : (
            <p className="notice">请选择一个图鉴</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function BookRow(props: {
  book: AlbumBookAdminItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr className={props.selected ? "is-selected" : ""}>
      <td>
        <strong>{props.book.display_name}</strong>
        <small>{props.book.code}</small>
      </td>
      <td>{props.book.book_type}</td>
      <td>{props.book.item_count}</td>
      <td>{props.book.milestones.length}</td>
      <td>{formatDate(props.book.updated_at)}</td>
      <td>
        <button className="icon-button" onClick={props.onSelect} type="button">
          选择
        </button>
      </td>
    </tr>
  );
}

function toDraft(milestone: AlbumMilestoneAdminItem): MilestoneDraft {
  return {
    id: milestone.id,
    title: milestone.title,
    required_count: String(milestone.required_count),
    reward: JSON.stringify(milestone.reward ?? [], null, 2),
    active: milestone.active,
    sort_order: String(milestone.sort_order),
    metadata: JSON.stringify(milestone.metadata ?? {}, null, 2),
  };
}

function serializeDraft(
  draft: MilestoneDraft,
  reason: string,
): UpdateAlbumMilestoneInput {
  return {
    id: draft.id,
    title: draft.title,
    required_count: parseInteger(draft.required_count, "门槛"),
    reward: parseReward(draft.reward),
    active: draft.active,
    sort_order: parseInteger(draft.sort_order, "排序"),
    metadata: parseJsonObject(draft.metadata),
    reason,
  };
}

function parseReward(
  value: string,
): Array<{ currency: "KCOIN" | "FGEMS"; amount: number }> {
  const parsed = JSON.parse(value || "[]") as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("reward 必须是 JSON array");
  }

  return parsed.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("reward 每一项必须是 object");
    }

    const record = item as Record<string, unknown>;
    const currency = String(record.currency ?? "").toUpperCase();
    const amount = Number(record.amount);

    if (currency !== "KCOIN" && currency !== "FGEMS") {
      throw new Error("reward currency 仅支持 KCOIN / FGEMS");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("reward amount 必须大于 0");
    }

    return {
      currency,
      amount,
    };
  });
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}") as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("metadata 必须是 JSON object");
  }

  return parsed as Record<string, unknown>;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} 必须是整数`);
  }

  return parsed;
}

function formatReward(value: unknown): string {
  if (!Array.isArray(value)) {
    return "-";
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      return `${record.amount ?? "-"} ${record.currency ?? ""}`.trim();
    })
    .filter(Boolean)
    .join(" + ");
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
