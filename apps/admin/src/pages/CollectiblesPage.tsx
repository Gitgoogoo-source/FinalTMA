import { RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchCollectibles, updateCollectibleTemplateOps } from "../admin.api";
import type {
  CollectibleAdminItem,
  CollectiblesAdminResponse,
  UpdateCollectibleTemplateOpsInput,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

const RELEASE_STATUSES = ["", "draft", "active", "hidden", "retired"];
const EDITABLE_STATUSES = ["draft", "active", "hidden", "retired"];

type CollectibleDraft = {
  id: string;
  slug: string;
  display_name: string;
  subtitle: string;
  description: string;
  rarity_code: string;
  type_code: string;
  series_id: string;
  faction_id: string;
  base_power: string;
  max_level: string;
  supply_limit: string;
  release_status: string;
  tradeable: boolean;
  upgradeable: boolean;
  evolvable: boolean;
  decomposable: boolean;
  nft_mintable: boolean;
  sort_order: string;
  metadata: string;
  forms: string;
  media: string;
};

export function CollectiblesPage({
  canWriteCatalog = false,
}: {
  canWriteCatalog?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CollectiblesAdminResponse | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<CollectibleDraft | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = data?.items ?? [];
  const selectedTemplate = useMemo(
    () =>
      items.find((item) => item.id === selectedTemplateId) ?? items[0] ?? null,
    [items, selectedTemplateId],
  );

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchCollectibles({
        status: status || undefined,
        q: query || undefined,
        limit: 50,
      });

      setData(response);
      setSelectedTemplateId((current) =>
        current && response.items.some((item) => item.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(readError(loadError, "藏品配置加载失败"));
      setData(null);
      setSelectedTemplateId(null);
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
      setError("保存藏品配置必须填写 reason");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const input = serializeDraft(draft, operationReason);
      await updateCollectibleTemplateOps(input);
      setNotice("藏品运营配置已保存，审计日志已写入。");
      await load();
    } catch (saveError) {
      setError(readError(saveError, "保存藏品配置失败"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selectedTemplate) {
      setDraft(toDraft(selectedTemplate));
    } else {
      setDraft(null);
    }
  }, [selectedTemplate]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {RELEASE_STATUSES.map((value) => (
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
            placeholder="slug / 名称"
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
                <th>藏品</th>
                <th>状态</th>
                <th>成长</th>
                <th>形态/媒体</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  className={
                    selectedTemplate?.id === item.id ? "is-selected" : ""
                  }
                  key={item.id}
                >
                  <td>
                    <strong>{item.display_name}</strong>
                    <small>{item.slug}</small>
                  </td>
                  <td>
                    <StatusBadge status={item.release_status} />
                    <small>{item.rarity_code}</small>
                  </td>
                  <td>
                    <small>{formatFeatureFlags(item)}</small>
                  </td>
                  <td>
                    <small>
                      {item.forms.length} forms / {countMedia(item)} media
                    </small>
                  </td>
                  <td>{formatDate(item.updated_at)}</td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => setSelectedTemplateId(item.id)}
                      type="button"
                    >
                      选择
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6}>暂无藏品配置</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <aside className="detail-panel">
          {selectedTemplate && draft ? (
            <>
              <header>
                <div>
                  <p>Template {shortId(selectedTemplate.id)}</p>
                  <h2>{selectedTemplate.display_name}</h2>
                </div>
                <StatusBadge status={selectedTemplate.release_status} />
              </header>

              <div className="form-grid">
                <label>
                  <span>Slug</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.slug}
                    onChange={(event) =>
                      setDraft({ ...draft, slug: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>名称</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.display_name}
                    onChange={(event) =>
                      setDraft({ ...draft, display_name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>稀有度</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.rarity_code}
                    onChange={(event) =>
                      setDraft({ ...draft, rarity_code: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>类型</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.type_code}
                    onChange={(event) =>
                      setDraft({ ...draft, type_code: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>系列 ID</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.series_id}
                    onChange={(event) =>
                      setDraft({ ...draft, series_id: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>阵营 ID</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    value={draft.faction_id}
                    onChange={(event) =>
                      setDraft({ ...draft, faction_id: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>基础战力</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    inputMode="numeric"
                    value={draft.base_power}
                    onChange={(event) =>
                      setDraft({ ...draft, base_power: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>等级上限</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    inputMode="numeric"
                    value={draft.max_level}
                    onChange={(event) =>
                      setDraft({ ...draft, max_level: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>供应上限</span>
                  <input
                    disabled={!canWriteCatalog || saving}
                    inputMode="numeric"
                    value={draft.supply_limit}
                    onChange={(event) =>
                      setDraft({ ...draft, supply_limit: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>发布状态</span>
                  <select
                    disabled={!canWriteCatalog || saving}
                    value={draft.release_status}
                    onChange={(event) =>
                      setDraft({ ...draft, release_status: event.target.value })
                    }
                  >
                    {EDITABLE_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
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
              </div>

              <label className="field-stack">
                <span>副标题</span>
                <input
                  disabled={!canWriteCatalog || saving}
                  value={draft.subtitle}
                  onChange={(event) =>
                    setDraft({ ...draft, subtitle: event.target.value })
                  }
                />
              </label>
              <label className="field-stack">
                <span>说明</span>
                <textarea
                  disabled={!canWriteCatalog || saving}
                  rows={3}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </label>

              <div className="toggle-list">
                <Toggle
                  checked={draft.tradeable}
                  disabled={!canWriteCatalog || saving}
                  label="可交易"
                  onChange={(tradeable) => setDraft({ ...draft, tradeable })}
                />
                <Toggle
                  checked={draft.upgradeable}
                  disabled={!canWriteCatalog || saving}
                  label="可升级"
                  onChange={(upgradeable) =>
                    setDraft({ ...draft, upgradeable })
                  }
                />
                <Toggle
                  checked={draft.evolvable}
                  disabled={!canWriteCatalog || saving}
                  label="可合成"
                  onChange={(evolvable) => setDraft({ ...draft, evolvable })}
                />
                <Toggle
                  checked={draft.decomposable}
                  disabled={!canWriteCatalog || saving}
                  label="可分解"
                  onChange={(decomposable) =>
                    setDraft({ ...draft, decomposable })
                  }
                />
                <Toggle
                  checked={draft.nft_mintable}
                  disabled={!canWriteCatalog || saving}
                  label="可 Mint"
                  onChange={(nft_mintable) =>
                    setDraft({ ...draft, nft_mintable })
                  }
                />
              </div>

              <label className="field-stack">
                <span>Forms JSON</span>
                <textarea
                  disabled={!canWriteCatalog || saving}
                  rows={8}
                  value={draft.forms}
                  onChange={(event) =>
                    setDraft({ ...draft, forms: event.target.value })
                  }
                />
              </label>
              <label className="field-stack">
                <span>Media JSON</span>
                <textarea
                  disabled={!canWriteCatalog || saving}
                  rows={8}
                  value={draft.media}
                  onChange={(event) =>
                    setDraft({ ...draft, media: event.target.value })
                  }
                />
              </label>
              <label className="field-stack">
                <span>Metadata JSON</span>
                <textarea
                  disabled={!canWriteCatalog || saving}
                  rows={8}
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
                  placeholder="说明本次运营修改原因"
                />
              </label>
              <button
                className="icon-button"
                disabled={!canWriteCatalog || saving}
                onClick={() => void save()}
                type="button"
              >
                <Save aria-hidden="true" size={17} />
                <span>{saving ? "保存中" : "保存配置"}</span>
              </button>
            </>
          ) : (
            <p className="notice">请选择一个藏品模板</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function Toggle(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label>
      <input
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{props.label}</span>
    </label>
  );
}

function toDraft(item: CollectibleAdminItem): CollectibleDraft {
  return {
    id: item.id,
    slug: item.slug,
    display_name: item.display_name,
    subtitle: item.subtitle ?? "",
    description: item.description ?? "",
    rarity_code: item.rarity_code,
    type_code: item.type_code,
    series_id: item.series_id ?? "",
    faction_id: item.faction_id ?? "",
    base_power: String(item.base_power),
    max_level: String(item.max_level),
    supply_limit: item.supply_limit === null ? "" : String(item.supply_limit),
    release_status: item.release_status,
    tradeable: item.tradeable,
    upgradeable: item.upgradeable,
    evolvable: item.evolvable,
    decomposable: item.decomposable,
    nft_mintable: item.nft_mintable,
    sort_order: String(item.sort_order),
    metadata: JSON.stringify(item.metadata ?? {}, null, 2),
    forms: JSON.stringify(item.forms ?? [], null, 2),
    media: JSON.stringify(item.media ?? [], null, 2),
  };
}

function serializeDraft(
  draft: CollectibleDraft,
  reason: string,
): UpdateCollectibleTemplateOpsInput {
  return {
    id: draft.id,
    slug: parseRequiredText(draft.slug, "Slug"),
    display_name: parseRequiredText(draft.display_name, "名称"),
    subtitle: parseOptionalText(draft.subtitle),
    description: parseOptionalText(draft.description),
    rarity_code: parseRequiredText(draft.rarity_code, "稀有度"),
    type_code: parseRequiredText(draft.type_code, "类型"),
    series_id: parseOptionalText(draft.series_id),
    faction_id: parseOptionalText(draft.faction_id),
    base_power: parseInteger(draft.base_power, "基础战力"),
    max_level: parseInteger(draft.max_level, "等级上限"),
    supply_limit: parseNullableInteger(draft.supply_limit, "供应上限"),
    release_status: draft.release_status,
    tradeable: draft.tradeable,
    upgradeable: draft.upgradeable,
    evolvable: draft.evolvable,
    decomposable: draft.decomposable,
    nft_mintable: draft.nft_mintable,
    sort_order: parseInteger(draft.sort_order, "排序"),
    metadata: parseJsonObject(draft.metadata),
    forms: parseJsonArray(draft.forms, "forms"),
    media: parseJsonArray(draft.media, "media"),
    reason,
  };
}

function formatFeatureFlags(item: CollectibleAdminItem): string {
  return [
    item.tradeable ? "trade" : null,
    item.upgradeable ? "upgrade" : null,
    item.evolvable ? "evolve" : null,
    item.decomposable ? "decompose" : null,
    item.nft_mintable ? "mint" : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function countMedia(item: CollectibleAdminItem): number {
  return Object.values(item.media_counts ?? {}).reduce(
    (total, value) => total + Number(value),
    0,
  );
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}") as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("metadata 必须是 JSON object");
  }

  return parsed as Record<string, unknown>;
}

function parseJsonArray(
  value: string,
  label: string,
): Array<Record<string, unknown>> {
  const parsed = JSON.parse(value || "[]") as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON array`);
  }

  parsed.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${label}[${index}] 必须是 object`);
    }
  });

  return parsed as Array<Record<string, unknown>>;
}

function parseRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} 不能为空`);
  }

  return normalized;
}

function parseOptionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} 必须是整数`);
  }

  return parsed;
}

function parseNullableInteger(value: string, label: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return parseInteger(normalized, label);
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
