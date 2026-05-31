import { PackageOpen, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchBlindBoxes,
  updateBlindBoxStatus,
  upsertBlindBox,
  upsertBoxPriceRule,
} from "../admin.api";
import type {
  BlindBoxAdminItem,
  BlindBoxesAdminResponse,
  BoxPriceRule,
  UpsertBlindBoxInput,
  UpsertBoxPriceRuleInput,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

const BOX_STATUS_OPTIONS = [
  "draft",
  "not_started",
  "active",
  "paused",
  "sold_out",
  "ended",
  "archived",
] as const;
type BoxStatusOption = (typeof BOX_STATUS_OPTIONS)[number];
const BOX_STATUSES = ["", ...BOX_STATUS_OPTIONS] as const;
const BOX_STATUS_TRANSITIONS: Readonly<
  Record<BoxStatusOption, readonly BoxStatusOption[]>
> = {
  draft: ["not_started", "active"],
  not_started: [],
  active: ["paused", "sold_out", "ended"],
  paused: [],
  sold_out: [],
  ended: ["archived"],
  archived: [],
};
const BOX_TIERS = ["", "normal", "rare", "legendary", "event"];
const PRICE_RULE_QUANTITIES = [1, 10];

type BlindBoxDraft = {
  id?: string;
  slug: string;
  display_name: string;
  description: string;
  tier: string;
  status: string;
  price_stars: string;
  total_stock: string;
  remaining_stock: string;
  open_reward_kcoin: string;
  cover_image_url: string;
  hero_image_url: string;
  starts_at: string;
  ends_at: string;
  sort_order: string;
  metadata: string;
};

type PriceRuleDraft = {
  id?: string;
  box_id: string;
  quantity: string;
  discount_bps: string;
  price_stars_override: string;
  active: boolean;
  starts_at: string;
  ends_at: string;
  metadata: string;
};

export function BlindBoxesPage() {
  const [status, setStatus] = useState("");
  const [tier, setTier] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<BlindBoxesAdminResponse | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BlindBoxDraft>(() =>
    createEmptyBlindBoxDraft(),
  );
  const [priceRuleDraft, setPriceRuleDraft] = useState<PriceRuleDraft>(() =>
    createEmptyPriceRuleDraft(""),
  );
  const [nextStatus, setNextStatus] = useState("active");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingBox, setSavingBox] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingPriceRule, setSavingPriceRule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const boxes = data?.items ?? [];
  const selectedBox = useMemo(() => {
    return boxes.find((box) => box.id === selectedBoxId) ?? boxes[0] ?? null;
  }, [boxes, selectedBoxId]);
  const draftStatusOptions = getEditableStatusOptions(
    draft.id ? selectedBox?.status : null,
  );
  const nextStatusOptions = getEditableStatusOptions(selectedBox?.status);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchBlindBoxes({
        status: status || undefined,
        tier: tier || undefined,
        q: query || undefined,
        limit: 50,
      });

      setData(response);
      setSelectedBoxId((current) =>
        current && response.items.some((box) => box.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(readError(loadError, "盲盒列表加载失败"));
      setData(null);
      setSelectedBoxId(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveBox() {
    const operationReason = reason.trim();

    if (!operationReason) {
      setError("保存盲盒必须填写 reason");
      return;
    }

    let input: UpsertBlindBoxInput;

    try {
      input = serializeBlindBoxDraft(draft, operationReason);
    } catch (serializeError) {
      setError(readError(serializeError, "盲盒表单校验失败"));
      return;
    }

    setSavingBox(true);
    setError(null);
    setNotice(null);

    try {
      const result = await upsertBlindBox(input);
      setNotice(
        `盲盒已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );
      await load();
    } catch (saveError) {
      setError(readError(saveError, "盲盒保存失败"));
    } finally {
      setSavingBox(false);
    }
  }

  async function saveStatus() {
    if (!selectedBox) {
      setError("请选择盲盒");
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError("修改状态必须填写 reason");
      return;
    }

    setSavingStatus(true);
    setError(null);
    setNotice(null);

    try {
      const result = await updateBlindBoxStatus({
        boxId: selectedBox.id,
        status: nextStatus,
        reason: operationReason,
      });
      setNotice(
        `状态已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );
      await load();
    } catch (saveError) {
      setError(readError(saveError, "盲盒状态更新失败"));
    } finally {
      setSavingStatus(false);
    }
  }

  async function savePriceRule() {
    const operationReason = reason.trim();

    if (!operationReason) {
      setError("保存价格规则必须填写 reason");
      return;
    }

    let input: UpsertBoxPriceRuleInput;

    try {
      input = serializePriceRuleDraft(priceRuleDraft, operationReason);
    } catch (serializeError) {
      setError(readError(serializeError, "价格规则表单校验失败"));
      return;
    }

    setSavingPriceRule(true);
    setError(null);
    setNotice(null);

    try {
      const result = await upsertBoxPriceRule(input);
      setNotice(
        `价格规则已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );
      await load();
    } catch (saveError) {
      setError(readError(saveError, "价格规则保存失败"));
    } finally {
      setSavingPriceRule(false);
    }
  }

  function selectBox(box: BlindBoxAdminItem) {
    setSelectedBoxId(box.id);
    setDraft(toBlindBoxDraft(box));
    setPriceRuleDraft(toPriceRuleDraft(findEditablePriceRule(box), box.id));
    setNextStatus(box.status);
    setNotice(null);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, [status, tier]);

  useEffect(() => {
    if (selectedBox) {
      const statusOptions = getEditableStatusOptions(selectedBox.status);

      setDraft(toBlindBoxDraft(selectedBox));
      setPriceRuleDraft(
        toPriceRuleDraft(findEditablePriceRule(selectedBox), selectedBox.id),
      );
      setNextStatus(
        statusOptions.includes(selectedBox.status as BoxStatusOption)
          ? selectedBox.status
          : (statusOptions[0] ?? "draft"),
      );
    } else {
      setDraft(createEmptyBlindBoxDraft());
      setPriceRuleDraft(createEmptyPriceRuleDraft(""));
      setNextStatus("active");
    }
  }, [selectedBox]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>状态</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            {BOX_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>档位</span>
          <select
            onChange={(event) => setTier(event.target.value)}
            value={tier}
          >
            {BOX_TIERS.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>盲盒 slug / name</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="box slug or display name"
            value={query}
          />
        </label>
        <button
          className="icon-button"
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>{loading ? "加载中" : "刷新"}</span>
        </button>
        <span className="toolbar__meta">
          {selectedBox
            ? `${selectedBox.display_name} / ${shortId(selectedBox.id)}`
            : "等待选择盲盒"}
        </span>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <BlindBoxSummary boxes={boxes} summary={data?.summary ?? {}} />

      <div className="split-grid">
        <section className="admin-surface">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>盲盒</th>
                  <th>价格</th>
                  <th>库存</th>
                  <th>状态</th>
                  <th>预览状态</th>
                  <th>Active pool</th>
                  <th>时间窗口</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((box) => (
                  <tr
                    className={selectedBox?.id === box.id ? "is-selected" : ""}
                    key={box.id}
                  >
                    <td>
                      <strong>{box.display_name}</strong>
                      <small>
                        {box.slug} / {box.tier}
                      </small>
                    </td>
                    <td>
                      <strong>{box.price_stars} Stars</strong>
                      <small>{box.open_reward_kcoin} K-coin reward</small>
                    </td>
                    <td>
                      <strong>
                        {box.remaining_stock ?? "-"} / {box.total_stock ?? "-"}
                      </strong>
                      <small>{box.active_item_count ?? 0} active rewards</small>
                    </td>
                    <td>
                      <StatusBadge status={box.status} />
                    </td>
                    <td>
                      <StatusBadge status={getBlindBoxPreviewStatus(box)} />
                    </td>
                    <td>
                      {box.active_version ? (
                        <>
                          <strong>v{box.active_version.version_no}</strong>
                          <small>{shortId(box.active_version.id)}</small>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <strong>{formatDate(box.starts_at)}</strong>
                      <small>{formatDate(box.ends_at)}</small>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => selectBox(box)}
                        type="button"
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {boxes.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={8}>暂无盲盒</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-surface">
          <section className="detail-panel config-editor">
            <div className="detail-panel__header">
              <div>
                <h2>盲盒配置</h2>
                <p>{draft.id ? shortId(draft.id) : "new blind box draft"}</p>
              </div>
              <StatusBadge status={getDraftPreviewStatus(draft)} />
            </div>
            <BlindBoxMediaPreview draft={draft} />
            <div className="form-grid form-grid--compact">
              <label>
                <span>Slug</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      slug: event.target.value,
                    }))
                  }
                  value={draft.slug}
                />
              </label>
              <label>
                <span>名称</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      display_name: event.target.value,
                    }))
                  }
                  value={draft.display_name}
                />
              </label>
              <label>
                <span>档位</span>
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      tier: event.target.value,
                    }))
                  }
                  value={draft.tier}
                >
                  {BOX_TIERS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>状态</span>
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                  value={draft.status}
                >
                  {draftStatusOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>单抽 Stars</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      price_stars: event.target.value,
                    }))
                  }
                  value={draft.price_stars}
                />
              </label>
              <label>
                <span>总库存</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      total_stock: event.target.value,
                    }))
                  }
                  value={draft.total_stock}
                />
              </label>
              <label>
                <span>剩余库存</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      remaining_stock: event.target.value,
                    }))
                  }
                  value={draft.remaining_stock}
                />
              </label>
              <label>
                <span>开盒返 K-coin</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      open_reward_kcoin: event.target.value,
                    }))
                  }
                  value={draft.open_reward_kcoin}
                />
              </label>
              <label>
                <span>开售时间</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      starts_at: event.target.value,
                    }))
                  }
                  type="datetime-local"
                  value={draft.starts_at}
                />
              </label>
              <label>
                <span>结束时间</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      ends_at: event.target.value,
                    }))
                  }
                  type="datetime-local"
                  value={draft.ends_at}
                />
              </label>
              <label>
                <span>排序权重</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sort_order: event.target.value,
                    }))
                  }
                  value={draft.sort_order}
                />
              </label>
              <label className="form-grid__wide">
                <span>封面 URL</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cover_image_url: event.target.value,
                    }))
                  }
                  value={draft.cover_image_url}
                />
              </label>
              <label className="form-grid__wide">
                <span>Hero URL</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      hero_image_url: event.target.value,
                    }))
                  }
                  value={draft.hero_image_url}
                />
              </label>
              <label className="form-grid__wide">
                <span>Description</span>
                <textarea
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  value={draft.description}
                />
              </label>
              <label className="form-grid__wide">
                <span>Metadata JSON</span>
                <textarea
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      metadata: event.target.value,
                    }))
                  }
                  value={draft.metadata}
                />
              </label>
              <label className="form-grid__wide">
                <span>操作 reason</span>
                <input
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="保存盲盒、状态或价格规则必填"
                  value={reason}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                className="icon-button"
                disabled={savingBox}
                onClick={() => void saveBox()}
                type="button"
              >
                <Save aria-hidden="true" size={16} />
                <span>{savingBox ? "保存中" : "保存盲盒"}</span>
              </button>
            </div>
          </section>

          <div className="split-grid split-grid--even">
            <section className="detail-panel">
              <div className="detail-panel__header">
                <div>
                  <h2>状态操作</h2>
                  <p>{selectedBox ? selectedBox.slug : "-"}</p>
                </div>
                {selectedBox ? (
                  <StatusBadge status={selectedBox.status} />
                ) : null}
              </div>
              <div className="form-grid form-grid--compact">
                <label className="form-grid__wide">
                  <span>下一状态</span>
                  <select
                    onChange={(event) => setNextStatus(event.target.value)}
                    value={nextStatus}
                  >
                    {nextStatusOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button
                  className="icon-button"
                  disabled={!selectedBox || savingStatus}
                  onClick={() => void saveStatus()}
                  type="button"
                >
                  <Save aria-hidden="true" size={16} />
                  <span>{savingStatus ? "提交中" : "提交状态"}</span>
                </button>
              </div>
            </section>

            <section className="detail-panel">
              <div className="detail-panel__header">
                <div>
                  <h2>价格规则</h2>
                  <p>
                    {priceRuleDraft.box_id
                      ? shortId(priceRuleDraft.box_id)
                      : "-"}
                  </p>
                </div>
                <StatusBadge
                  status={priceRuleDraft.active ? "active" : "paused"}
                />
              </div>
              <PriceRulesList box={selectedBox} />
              <div className="form-grid form-grid--compact price-rule-form">
                <label>
                  <span>抽数</span>
                  <select
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    value={priceRuleDraft.quantity}
                  >
                    {PRICE_RULE_QUANTITIES.map((quantity) => (
                      <option key={quantity} value={quantity}>
                        {quantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>折扣 bps</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        discount_bps: event.target.value,
                      }))
                    }
                    value={priceRuleDraft.discount_bps}
                  />
                </label>
                <label>
                  <span>覆盖单价</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        price_stars_override: event.target.value,
                      }))
                    }
                    value={priceRuleDraft.price_stars_override}
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    checked={priceRuleDraft.active}
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        active: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>active</span>
                </label>
                <label>
                  <span>开始时间</span>
                  <input
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        starts_at: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={priceRuleDraft.starts_at}
                  />
                </label>
                <label>
                  <span>结束时间</span>
                  <input
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        ends_at: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={priceRuleDraft.ends_at}
                  />
                </label>
                <label className="form-grid__wide">
                  <span>Metadata JSON</span>
                  <textarea
                    onChange={(event) =>
                      setPriceRuleDraft((current) => ({
                        ...current,
                        metadata: event.target.value,
                      }))
                    }
                    value={priceRuleDraft.metadata}
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  className="icon-button"
                  disabled={!priceRuleDraft.box_id || savingPriceRule}
                  onClick={() => void savePriceRule()}
                  type="button"
                >
                  <Save aria-hidden="true" size={16} />
                  <span>{savingPriceRule ? "保存中" : "保存价格规则"}</span>
                </button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </section>
  );
}

function BlindBoxSummary(props: {
  boxes: BlindBoxAdminItem[];
  summary: Record<string, number>;
}) {
  const activeCount = props.summary.active ?? 0;
  const soldOutCount = props.summary.sold_out ?? 0;
  const scheduledCount = props.boxes.filter(
    (box) => getBlindBoxPreviewStatus(box) === "not_started",
  ).length;

  return (
    <div className="metric-strip">
      <span>
        <small>总盲盒</small>
        <strong>{props.boxes.length}</strong>
      </span>
      <span>
        <small>active</small>
        <strong>{activeCount}</strong>
      </span>
      <span>
        <small>not_started</small>
        <strong>{scheduledCount}</strong>
      </span>
      <span>
        <small>sold_out</small>
        <strong>{soldOutCount}</strong>
      </span>
    </div>
  );
}

function BlindBoxMediaPreview({ draft }: { draft: BlindBoxDraft }) {
  const imageUrl = draft.hero_image_url || draft.cover_image_url;

  return (
    <div className="campaign-preview blind-box-preview">
      {imageUrl ? (
        <img alt={draft.display_name || "blind box preview"} src={imageUrl} />
      ) : (
        <span>
          <PackageOpen aria-hidden="true" size={24} />
        </span>
      )}
      <div>
        <strong>{draft.display_name || "Untitled blind box"}</strong>
        <small>
          {draft.tier} / {draft.price_stars || "-"} Stars
        </small>
      </div>
    </div>
  );
}

function PriceRulesList({ box }: { box: BlindBoxAdminItem | null }) {
  const rules = box?.price_rules ?? [];

  if (!box) {
    return <p className="muted">请选择盲盒</p>;
  }

  if (rules.length === 0) {
    return (
      <p className="muted">
        当前读取接口未返回 price rules；后续接入 `/api/admin/blind-boxes`
        后会在这里展示。
      </p>
    );
  }

  return (
    <div className="stack-list stack-list--spaced">
      {rules.map((rule) => (
        <div className="list-row" key={rule.id}>
          <span>
            <strong>{rule.quantity} 抽</strong>
            <small>
              {formatPriceRule(rule, box.price_stars)} /{" "}
              {formatDate(rule.starts_at)} - {formatDate(rule.ends_at)}
            </small>
          </span>
          <StatusBadge status={rule.active ? "active" : "paused"} />
        </div>
      ))}
    </div>
  );
}

function getEditableStatusOptions(
  currentStatus: string | null | undefined,
): BoxStatusOption[] {
  if (!currentStatus || !isBoxStatusOption(currentStatus)) {
    return [...BOX_STATUS_OPTIONS];
  }

  return [currentStatus, ...BOX_STATUS_TRANSITIONS[currentStatus]];
}

function isBoxStatusOption(value: string): value is BoxStatusOption {
  return (BOX_STATUS_OPTIONS as readonly string[]).includes(value);
}

function createEmptyBlindBoxDraft(): BlindBoxDraft {
  return {
    slug: "",
    display_name: "",
    description: "",
    tier: "normal",
    status: "draft",
    price_stars: "",
    total_stock: "",
    remaining_stock: "",
    open_reward_kcoin: "100",
    cover_image_url: "",
    hero_image_url: "",
    starts_at: "",
    ends_at: "",
    sort_order: "100",
    metadata: "{}",
  };
}

function toBlindBoxDraft(box: BlindBoxAdminItem): BlindBoxDraft {
  return {
    id: box.id,
    slug: box.slug,
    display_name: box.display_name,
    description: box.description ?? "",
    tier: box.tier,
    status: box.status,
    price_stars: String(box.price_stars),
    total_stock: box.total_stock === null ? "" : String(box.total_stock),
    remaining_stock:
      box.remaining_stock === null ? "" : String(box.remaining_stock),
    open_reward_kcoin: String(box.open_reward_kcoin),
    cover_image_url: box.cover_image_url ?? "",
    hero_image_url: box.hero_image_url ?? "",
    starts_at: toDateTimeLocal(box.starts_at),
    ends_at: toDateTimeLocal(box.ends_at),
    sort_order: String(box.sort_order),
    metadata: JSON.stringify(box.metadata ?? {}, null, 2),
  };
}

function createEmptyPriceRuleDraft(boxId: string): PriceRuleDraft {
  return {
    box_id: boxId,
    quantity: "10",
    discount_bps: "1000",
    price_stars_override: "",
    active: true,
    starts_at: "",
    ends_at: "",
    metadata: "{}",
  };
}

function toPriceRuleDraft(
  rule: BoxPriceRule | null,
  boxId?: string,
): PriceRuleDraft {
  if (!rule) {
    return createEmptyPriceRuleDraft(boxId ?? "");
  }

  return {
    id: rule.id,
    box_id: rule.box_id,
    quantity: String(rule.quantity),
    discount_bps: String(rule.discount_bps),
    price_stars_override:
      rule.price_stars_override === null
        ? ""
        : String(rule.price_stars_override),
    active: rule.active,
    starts_at: toDateTimeLocal(rule.starts_at),
    ends_at: toDateTimeLocal(rule.ends_at),
    metadata: JSON.stringify(rule.metadata ?? {}, null, 2),
  };
}

function findEditablePriceRule(box: BlindBoxAdminItem): BoxPriceRule | null {
  const rules = box.price_rules ?? [];
  return (
    rules.find((rule) => rule.active && rule.quantity === 10) ??
    rules.find((rule) => rule.active) ??
    rules[0] ??
    null
  );
}

function serializeBlindBoxDraft(
  draft: BlindBoxDraft,
  reason: string,
): UpsertBlindBoxInput {
  const slug = draft.slug.trim();
  const displayName = draft.display_name.trim();
  const priceStars = parseRequiredInteger(draft.price_stars, "price_stars", {
    min: 1,
  });
  const totalStock = parseNullableInteger(draft.total_stock, "total_stock", {
    min: 0,
  });
  const remainingStock = parseNullableInteger(
    draft.remaining_stock,
    "remaining_stock",
    { min: 0 },
  );
  const openRewardKcoin = parseRequiredInteger(
    draft.open_reward_kcoin,
    "open_reward_kcoin",
    { min: 0 },
  );
  const sortOrder = parseRequiredInteger(draft.sort_order, "sort_order");
  const startsAt = toIsoOrNull(draft.starts_at);
  const endsAt = toIsoOrNull(draft.ends_at);

  if (!slug || !displayName) {
    throw new Error("slug 和 display_name 为必填项");
  }

  if (
    totalStock !== null &&
    remainingStock !== null &&
    remainingStock > totalStock
  ) {
    throw new Error("remaining_stock 不能大于 total_stock");
  }

  assertValidTimeWindow(startsAt, endsAt);

  const input: UpsertBlindBoxInput = {
    slug,
    display_name: displayName,
    description: draft.description.trim() || null,
    tier: draft.tier,
    status: draft.status,
    price_stars: priceStars,
    total_stock: totalStock,
    remaining_stock: remainingStock,
    open_reward_kcoin: openRewardKcoin,
    cover_image_url: draft.cover_image_url.trim() || null,
    hero_image_url: draft.hero_image_url.trim() || null,
    starts_at: startsAt,
    ends_at: endsAt,
    sort_order: sortOrder,
    metadata: parseMetadata(draft.metadata),
    reason,
  };

  if (draft.id) {
    input.id = draft.id;
  }

  return input;
}

function serializePriceRuleDraft(
  draft: PriceRuleDraft,
  reason: string,
): UpsertBoxPriceRuleInput {
  const quantity = parseRequiredInteger(draft.quantity, "quantity", {
    allowed: PRICE_RULE_QUANTITIES,
  });
  const discountBps = parseRequiredInteger(draft.discount_bps, "discount_bps", {
    min: 0,
    max: 10000,
  });
  const priceStarsOverride = parseNullableInteger(
    draft.price_stars_override,
    "price_stars_override",
    { min: 1 },
  );
  const startsAt = toIsoOrNull(draft.starts_at);
  const endsAt = toIsoOrNull(draft.ends_at);

  if (!draft.box_id) {
    throw new Error("box_id 缺失");
  }

  assertValidTimeWindow(startsAt, endsAt);

  const input: UpsertBoxPriceRuleInput = {
    box_id: draft.box_id,
    quantity,
    discount_bps: discountBps,
    price_stars_override: priceStarsOverride,
    active: draft.active,
    starts_at: startsAt,
    ends_at: endsAt,
    metadata: parseMetadata(draft.metadata),
    reason,
  };

  if (draft.id) {
    input.id = draft.id;
  }

  return input;
}

function getBlindBoxPreviewStatus(box: BlindBoxAdminItem): string {
  if (box.status === "paused" || box.status === "ended") {
    return box.status;
  }

  if (box.remaining_stock !== null && Number(box.remaining_stock) <= 0) {
    return "sold_out";
  }

  return getWindowPreviewStatus({
    status: box.status,
    startsAt: box.starts_at,
    endsAt: box.ends_at,
  });
}

function getDraftPreviewStatus(draft: BlindBoxDraft): string {
  const remainingStock = Number.parseInt(draft.remaining_stock, 10);

  if (Number.isFinite(remainingStock) && remainingStock <= 0) {
    return "sold_out";
  }

  return getWindowPreviewStatus({
    status: draft.status,
    startsAt: toIsoOrNull(draft.starts_at),
    endsAt: toIsoOrNull(draft.ends_at),
  });
}

function getWindowPreviewStatus(input: {
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}): string {
  const now = Date.now();
  const startsAtMs = input.startsAt ? Date.parse(input.startsAt) : null;
  const endsAtMs = input.endsAt ? Date.parse(input.endsAt) : null;

  if (
    input.status === "draft" ||
    input.status === "paused" ||
    input.status === "sold_out" ||
    input.status === "ended" ||
    input.status === "archived"
  ) {
    return input.status;
  }

  if (startsAtMs !== null && Number.isFinite(startsAtMs) && startsAtMs > now) {
    return "not_started";
  }

  if (endsAtMs !== null && Number.isFinite(endsAtMs) && endsAtMs <= now) {
    return "ended";
  }

  return input.status === "active" ? "active" : input.status;
}

function formatPriceRule(
  rule: BoxPriceRule,
  fallbackUnitPrice: number,
): string {
  const unitPrice = rule.price_stars_override ?? fallbackUnitPrice;
  const totalPrice = Math.ceil(
    (unitPrice * rule.quantity * (10000 - rule.discount_bps)) / 10000,
  );

  return `${totalPrice} Stars / ${formatBps(rule.discount_bps)}`;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}% off`;
}

function parseRequiredInteger(
  value: string,
  field: string,
  options: { min?: number; max?: number; allowed?: number[] } = {},
): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} 必须是整数`);
  }

  if (options.allowed && !options.allowed.includes(parsed)) {
    throw new Error(`${field} 只能是 ${options.allowed.join(" / ")}`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${field} 不能小于 ${options.min}`);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${field} 不能大于 ${options.max}`);
  }

  return parsed;
}

function parseNullableInteger(
  value: string,
  field: string,
  options: { min?: number; max?: number } = {},
): number | null {
  if (!value.trim()) {
    return null;
  }

  return parseRequiredInteger(value, field, options);
}

function parseMetadata(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("metadata 必须是 JSON object");
  }

  return parsed as Record<string, unknown>;
}

function assertValidTimeWindow(
  startsAt: string | null,
  endsAt: string | null,
): void {
  if (!startsAt || !endsAt) {
    return;
  }

  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error("starts_at 必须早于 ends_at");
  }
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("时间格式无效");
  }

  return date.toISOString();
}

function toDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
