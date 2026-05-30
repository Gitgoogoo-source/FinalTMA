import {
  Archive,
  CheckCircle2,
  RefreshCw,
  Rocket,
  Save,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  archiveDropPoolVersion,
  fetchBlindBoxAdminItems,
  fetchDropPoolItems,
  fetchDropPoolVersions,
  fetchPityRules,
  publishDropPoolVersion,
  saveDropPoolDraft,
  validateDropPoolVersion,
} from "../admin.api";
import type {
  BlindBoxAdminItem,
  DropPoolDraftItemInput,
  DropPoolDraftPityRuleInput,
  DropPoolItem,
  DropPoolValidationIssue,
  DropPoolValidationResult,
  DropPoolVersion,
  PityRule,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

type BusyAction = "save" | "validate" | "publish" | "archive" | null;
type PageError = {
  message: string;
  code?: string;
  requestId?: string | null;
};

export function GachaPoolsPage() {
  const [boxes, setBoxes] = useState<BlindBoxAdminItem[]>([]);
  const [versions, setVersions] = useState<DropPoolVersion[]>([]);
  const [draftItems, setDraftItems] = useState<DropPoolItem[]>([]);
  const [pityRules, setPityRules] = useState<PityRule[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [loadingBoxes, setLoadingBoxes] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [validation, setValidation] = useState<DropPoolValidationResult | null>(
    null,
  );

  const selectedBox =
    boxes.find((box) => box.id === selectedBoxId) ?? boxes[0] ?? null;
  const activeVersion = useMemo(() => {
    return (
      versions.find((version) => version.status === "active") ??
      selectedBox?.active_version ??
      null
    );
  }, [selectedBox, versions]);
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ??
    activeVersion ??
    versions[0] ??
    null;
  const selectedVersionReadOnly =
    !selectedVersion || selectedVersion.status !== "draft";

  async function loadBoxes() {
    setLoadingBoxes(true);
    setError(null);

    try {
      const response = await fetchBlindBoxAdminItems({ limit: 50 });
      setBoxes(response.items);
      setSelectedBoxId((current) =>
        current && response.items.some((box) => box.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(readAdminError(loadError, "盲盒列表加载失败"));
    } finally {
      setLoadingBoxes(false);
    }
  }

  async function loadVersions(boxId: string) {
    setLoadingVersions(true);
    setError(null);
    setValidation(null);

    try {
      const response = await fetchDropPoolVersions({ boxId, limit: 50 });
      const nextVersions = response.items;
      const nextActive =
        response.activeVersion ??
        nextVersions.find((version) => version.status === "active") ??
        null;

      setVersions(nextVersions);
      setSelectedVersionId((current) =>
        current && nextVersions.some((version) => version.id === current)
          ? current
          : (nextActive?.id ?? nextVersions[0]?.id ?? null),
      );
    } catch (loadError) {
      setVersions([]);
      setSelectedVersionId(null);
      setError(readAdminError(loadError, "概率版本加载失败"));
    } finally {
      setLoadingVersions(false);
    }
  }

  async function loadVersionDetails(boxId: string, poolVersionId: string) {
    setLoadingItems(true);
    setError(null);

    try {
      const [itemResponse, pityResponse] = await Promise.all([
        fetchDropPoolItems({ poolVersionId, limit: 500 }),
        fetchPityRules({ boxId, poolVersionId, limit: 20 }),
      ]);

      setDraftItems(itemResponse.items.map((item) => ({ ...item })));
      setPityRules(pityResponse.items);
    } catch (loadError) {
      setDraftItems([]);
      setPityRules([]);
      setError(readAdminError(loadError, "奖励项加载失败"));
    } finally {
      setLoadingItems(false);
    }
  }

  async function reloadSelected() {
    await loadBoxes();

    if (selectedBoxId) {
      await loadVersions(selectedBoxId);
    }

    if (selectedBoxId && selectedVersionId) {
      await loadVersionDetails(selectedBoxId, selectedVersionId);
    }
  }

  async function handleSaveDraft() {
    if (!selectedBox || !selectedVersion) {
      setError({ message: "请选择盲盒和概率版本" });
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError({ message: "保存草稿必须填写 reason" });
      return;
    }

    setBusyAction("save");
    setError(null);
    setNotice(null);

    try {
      const result = await saveDropPoolDraft({
        boxId: selectedBox.id,
        dropPoolVersionId: selectedVersion.id,
        items: draftItems.map(serializeDraftItem),
        pityRules: pityRules.map(serializeDraftPityRule),
        reason: operationReason,
      });

      setNotice(
        `草稿已保存${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );
      await loadVersions(selectedBox.id);
      await loadVersionDetails(selectedBox.id, selectedVersion.id);
    } catch (saveError) {
      setError(readAdminError(saveError, "保存草稿失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleValidate() {
    if (!selectedVersion) {
      setError({ message: "请选择概率版本" });
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError({ message: "校验版本必须填写 reason" });
      return;
    }

    setBusyAction("validate");
    setError(null);
    setNotice(null);

    try {
      const result = await validateDropPoolVersion({
        dropPoolVersionId: selectedVersion.id,
        reason: operationReason,
      });

      setValidation(normalizeValidationResult(result));
      setNotice(result.valid ? "校验通过" : "校验未通过");
    } catch (validateError) {
      setError(readAdminError(validateError, "校验概率版本失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePublish() {
    if (!selectedVersion) {
      setError({ message: "请选择概率版本" });
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError({ message: "发布版本必须填写 reason" });
      return;
    }

    setBusyAction("publish");
    setError(null);
    setNotice(null);

    try {
      const result = await publishDropPoolVersion({
        dropPoolVersionId: selectedVersion.id,
        reason: operationReason,
      });

      setNotice(
        `发布已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );

      if (selectedBox) {
        await loadVersions(selectedBox.id);
      }
    } catch (publishError) {
      setError(readAdminError(publishError, "发布概率版本失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchive() {
    if (!selectedVersion) {
      setError({ message: "请选择概率版本" });
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError({ message: "归档版本必须填写 reason" });
      return;
    }

    setBusyAction("archive");
    setError(null);
    setNotice(null);

    try {
      const result = await archiveDropPoolVersion({
        dropPoolVersionId: selectedVersion.id,
        reason: operationReason,
      });

      setNotice(
        `归档已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );

      if (selectedBox) {
        await loadVersions(selectedBox.id);
      }
    } catch (archiveError) {
      setError(readAdminError(archiveError, "归档概率版本失败"));
    } finally {
      setBusyAction(null);
    }
  }

  function selectBox(boxId: string) {
    setSelectedBoxId(boxId);
    setSelectedVersionId(null);
    setVersions([]);
    setDraftItems([]);
    setPityRules([]);
    setValidation(null);
    setNotice(null);
  }

  function updateDraftItem(index: number, patch: Partial<DropPoolItem>) {
    setDraftItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  useEffect(() => {
    void loadBoxes();
  }, []);

  useEffect(() => {
    if (selectedBoxId) {
      void loadVersions(selectedBoxId);
    }
  }, [selectedBoxId]);

  useEffect(() => {
    if (selectedBoxId && selectedVersionId) {
      void loadVersionDetails(selectedBoxId, selectedVersionId);
    }
  }, [selectedBoxId, selectedVersionId]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <button
          className="icon-button"
          disabled={loadingBoxes || loadingVersions || loadingItems}
          onClick={() => void reloadSelected()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>
            {loadingBoxes || loadingVersions || loadingItems
              ? "加载中"
              : "刷新"}
          </span>
        </button>
        <label className="toolbar__search">
          <span>操作 reason</span>
          <input
            onChange={(event) => setReason(event.target.value)}
            placeholder="发布、归档、保存草稿必填"
            value={reason}
          />
        </label>
        <span className="toolbar__meta">
          {selectedBox
            ? `${selectedBox.display_name} / ${selectedBox.slug}`
            : "等待选择盲盒"}
        </span>
      </div>

      {error ? <AdminErrorNotice error={error} /> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="gacha-pools-layout">
        <section className="ops-card gacha-box-list" aria-label="盲盒列表">
          <div className="gacha-section-header">
            <h2>盲盒</h2>
            <StatusBadge status={loadingBoxes ? "processing" : "ok"} />
          </div>
          {boxes.length === 0 && !loadingBoxes ? (
            <p className="muted">暂无盲盒</p>
          ) : null}
          {boxes.map((box) => (
            <button
              className={
                selectedBox?.id === box.id
                  ? "gacha-box-button is-selected"
                  : "gacha-box-button"
              }
              key={box.id}
              onClick={() => selectBox(box.id)}
              type="button"
            >
              <span>
                <strong>{box.display_name}</strong>
                <small>{box.slug}</small>
              </span>
              <span className="gacha-box-meta">
                <StatusBadge status={box.status} />
                <small>{box.price_stars} Stars</small>
              </span>
            </button>
          ))}
        </section>

        <div className="gacha-pools-main">
          <SelectedBoxPanel
            activeVersion={activeVersion}
            box={selectedBox}
            selectedVersion={selectedVersion}
            versions={versions}
          />

          <section className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <h2>版本列表</h2>
                <p>{selectedBox ? selectedBox.id : "-"}</p>
              </div>
              <StatusBadge status={loadingVersions ? "processing" : "ok"} />
            </div>
            <div className="table-wrap table-wrap--small">
              <table>
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>状态</th>
                    <th>权重</th>
                    <th>发布时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr
                      className={
                        selectedVersion?.id === version.id ? "is-selected" : ""
                      }
                      key={version.id}
                    >
                      <td>
                        <strong>v{version.version_no}</strong>
                        <small>{shortId(version.id)}</small>
                      </td>
                      <td>
                        <StatusBadge status={version.status} />
                      </td>
                      <td>{formatNumeric(version.total_weight)}</td>
                      <td>{formatDate(version.published_at)}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelectedVersionId(version.id);
                            setValidation(null);
                          }}
                          type="button"
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                  {versions.length === 0 ? (
                    <tr>
                      <td colSpan={5}>暂无概率版本</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <h2>草稿编辑区</h2>
                <p>
                  {selectedVersion
                    ? `当前版本 ${shortId(selectedVersion.id)}`
                    : "-"}
                </p>
              </div>
              <span className="list-row__actions">
                {selectedVersion ? (
                  <StatusBadge status={selectedVersion.status} />
                ) : null}
                {activeVersion ? (
                  <StatusBadge status={`active-v${activeVersion.version_no}`} />
                ) : null}
              </span>
            </div>

            {selectedVersionReadOnly ? (
              <p className="notice">
                当前版本不是 draft，只允许查看；线上 active version
                已在上方固定展示。
              </p>
            ) : null}

            <div className="gacha-editor-actions">
              <button
                className="icon-button"
                disabled={selectedVersionReadOnly || busyAction === "save"}
                onClick={() => void handleSaveDraft()}
                type="button"
              >
                <Save aria-hidden="true" size={16} />
                <span>{busyAction === "save" ? "保存中" : "保存草稿"}</span>
              </button>
              <button
                className="icon-button"
                disabled={!selectedVersion || busyAction === "validate"}
                onClick={() => void handleValidate()}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={16} />
                <span>{busyAction === "validate" ? "校验中" : "校验"}</span>
              </button>
              <button
                className="icon-button icon-button--danger"
                disabled={
                  !selectedVersion ||
                  selectedVersion.status !== "draft" ||
                  busyAction === "publish"
                }
                onClick={() => void handlePublish()}
                type="button"
              >
                <Rocket aria-hidden="true" size={16} />
                <span>{busyAction === "publish" ? "发布中" : "发布"}</span>
              </button>
              <button
                className="icon-button icon-button--danger"
                disabled={
                  !selectedVersion ||
                  selectedVersion.status !== "active" ||
                  busyAction === "archive"
                }
                onClick={() => void handleArchive()}
                type="button"
              >
                <Archive aria-hidden="true" size={16} />
                <span>{busyAction === "archive" ? "归档中" : "归档"}</span>
              </button>
            </div>

            <DropPoolItemsTable
              items={draftItems}
              loading={loadingItems}
              readOnly={selectedVersionReadOnly}
              totalWeight={selectedVersion?.total_weight ?? 0}
              updateDraftItem={updateDraftItem}
            />
          </section>

          <div className="split-grid split-grid--even">
            <PityRulesPanel rules={pityRules} />
            <ValidationPanel validation={validation} />
          </div>
        </div>
      </div>
    </section>
  );
}

function SelectedBoxPanel(props: {
  activeVersion: DropPoolVersion | null;
  box: BlindBoxAdminItem | null;
  selectedVersion: DropPoolVersion | null;
  versions: DropPoolVersion[];
}) {
  return (
    <section className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <h2>{props.box?.display_name ?? "未选择盲盒"}</h2>
          <p>{props.box?.description ?? props.box?.slug ?? "-"}</p>
        </div>
        {props.box ? <StatusBadge status={props.box.status} /> : null}
      </div>
      <div className="detail-grid">
        <DetailItem
          label="Box ID"
          value={props.box ? shortId(props.box.id) : "-"}
        />
        <DetailItem label="档位" value={props.box?.tier ?? "-"} />
        <DetailItem
          label="价格"
          value={props.box ? `${props.box.price_stars} Stars` : "-"}
        />
        <DetailItem
          label="库存"
          value={
            props.box
              ? `${props.box.remaining_stock ?? "-"} / ${props.box.total_stock ?? "-"}`
              : "-"
          }
        />
        <DetailItem
          label="当前 active version"
          value={
            props.activeVersion
              ? `v${props.activeVersion.version_no} / ${shortId(props.activeVersion.id)}`
              : "-"
          }
        />
        <DetailItem
          label="选中版本"
          value={
            props.selectedVersion
              ? `v${props.selectedVersion.version_no} / ${props.selectedVersion.status}`
              : "-"
          }
        />
        <DetailItem label="版本数" value={String(props.versions.length)} />
        <DetailItem
          label="更新时间"
          value={formatDate(props.box?.updated_at ?? null)}
        />
      </div>
    </section>
  );
}

function DropPoolItemsTable(props: {
  items: DropPoolItem[];
  loading: boolean;
  readOnly: boolean;
  totalWeight: number | string;
  updateDraftItem: (index: number, patch: Partial<DropPoolItem>) => void;
}) {
  if (props.loading) {
    return <p className="notice">奖励项加载中...</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>藏品</th>
            <th>稀有度</th>
            <th>权重</th>
            <th>概率</th>
            <th>库存</th>
            <th>保底</th>
            <th>Featured</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item, index) => (
            <tr key={item.id}>
              <td>
                <strong>{getItemLabel(item)}</strong>
                <small>
                  {shortId(item.template_id)}
                  {item.form_id ? ` / ${shortId(item.form_id)}` : ""}
                </small>
              </td>
              <td>
                <StatusBadge status={item.rarity_code} />
              </td>
              <td>
                {props.readOnly ? (
                  formatNumeric(item.drop_weight)
                ) : (
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      props.updateDraftItem(index, {
                        drop_weight: event.target.value,
                      })
                    }
                    value={String(item.drop_weight)}
                  />
                )}
              </td>
              <td>{formatProbability(item, props.totalWeight)}</td>
              <td>
                {props.readOnly ? (
                  `${item.stock_remaining ?? "-"} / ${item.stock_total ?? "-"}`
                ) : (
                  <div className="gacha-stock-inputs">
                    <input
                      inputMode="numeric"
                      onChange={(event) =>
                        props.updateDraftItem(index, {
                          stock_remaining: event.target.value,
                        })
                      }
                      placeholder="remaining"
                      value={String(item.stock_remaining ?? "")}
                    />
                    <input
                      inputMode="numeric"
                      onChange={(event) =>
                        props.updateDraftItem(index, {
                          stock_total: event.target.value,
                        })
                      }
                      placeholder="total"
                      value={String(item.stock_total ?? "")}
                    />
                  </div>
                )}
              </td>
              <td>
                <label className="checkbox-row">
                  <input
                    checked={item.is_pity_eligible}
                    disabled={props.readOnly}
                    onChange={(event) =>
                      props.updateDraftItem(index, {
                        is_pity_eligible: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>{item.is_pity_eligible ? "yes" : "no"}</span>
                </label>
              </td>
              <td>
                <label className="checkbox-row">
                  <input
                    checked={item.is_featured}
                    disabled={props.readOnly}
                    onChange={(event) =>
                      props.updateDraftItem(index, {
                        is_featured: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>{item.is_featured ? "yes" : "no"}</span>
                </label>
              </td>
            </tr>
          ))}
          {props.items.length === 0 ? (
            <tr>
              <td colSpan={7}>暂无奖励项</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function PityRulesPanel({ rules }: { rules: PityRule[] }) {
  return (
    <section className="ops-card">
      <h2>保底规则</h2>
      <div className="stack-list stack-list--spaced">
        {rules.length === 0 ? <p className="muted">暂无保底规则</p> : null}
        {rules.map((rule) => (
          <div className="list-row" key={rule.id}>
            <span>
              <strong>{rule.rule_name}</strong>
              <small>
                {rule.threshold} 次 / {rule.target_rarity_code}
                {rule.reset_on_rarity_code
                  ? ` / reset ${rule.reset_on_rarity_code}`
                  : ""}
              </small>
            </span>
            <StatusBadge status={rule.active ? "enabled" : "paused"} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ValidationPanel({
  validation,
}: {
  validation: DropPoolValidationResult | null;
}) {
  const errors = validation?.validation_errors ?? [];
  const warnings = validation?.warnings ?? [];

  return (
    <section className="ops-card">
      <h2>校验结果</h2>
      {!validation ? <p className="muted">暂无校验结果</p> : null}
      {validation ? (
        <div className="stack-list stack-list--spaced">
          <div className="list-row">
            <span>
              <strong>{validation.valid ? "valid" : "invalid"}</strong>
              <small>
                total weight {formatNumeric(validation.total_weight ?? "-")}
              </small>
            </span>
            <StatusBadge status={validation.valid ? "ok" : "failed"} />
          </div>
          <ValidationIssues title="Errors" issues={errors} />
          <ValidationIssues title="Warnings" issues={warnings} />
        </div>
      ) : null}
    </section>
  );
}

function ValidationIssues(props: {
  title: string;
  issues: DropPoolValidationIssue[];
}) {
  if (props.issues.length === 0) {
    return (
      <div className="list-row">
        <span>
          <strong>{props.title}</strong>
          <small>none</small>
        </span>
        <StatusBadge status="ok" />
      </div>
    );
  }

  return (
    <div className="validation-list">
      <strong>{props.title}</strong>
      {props.issues.map((issue) => (
        <span key={`${issue.code}:${issue.field ?? issue.message}`}>
          <StatusBadge status={issue.severity ?? "warning"} />
          <small>
            {issue.code}
            {issue.field ? ` / ${issue.field}` : ""}: {issue.message}
          </small>
        </span>
      ))}
    </div>
  );
}

function AdminErrorNotice({ error }: { error: PageError }) {
  return (
    <p className="notice notice--error">
      {error.message}
      {error.code ? ` / ${error.code}` : ""}
      {error.requestId ? ` / requestId: ${error.requestId}` : ""}
    </p>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <span>
      <small>{props.label}</small>
      <strong>{props.value}</strong>
    </span>
  );
}

function serializeDraftItem(item: DropPoolItem): DropPoolDraftItemInput {
  return {
    id: item.id,
    template_id: requireText(item.template_id, "template_id"),
    form_id: item.form_id || null,
    rarity_code: requireText(item.rarity_code, "rarity_code"),
    drop_weight: normalizePositiveNumber(item.drop_weight, "drop_weight"),
    probability_bps: normalizeNullableNumber(item.probability_bps),
    stock_total: normalizeNullableNumber(item.stock_total),
    stock_remaining: normalizeNullableNumber(item.stock_remaining),
    is_pity_eligible: item.is_pity_eligible,
    is_featured: item.is_featured,
    sort_order: item.sort_order,
    metadata: item.metadata,
  };
}

function serializeDraftPityRule(rule: PityRule): DropPoolDraftPityRuleInput {
  return {
    id: rule.id,
    rule_name: rule.rule_name,
    threshold: rule.threshold,
    target_rarity_code: rule.target_rarity_code,
    reset_on_rarity_code: rule.reset_on_rarity_code,
    guaranteed_template_id: rule.guaranteed_template_id,
    guaranteed_form_id: rule.guaranteed_form_id,
    priority: rule.priority,
    active: rule.active,
    metadata: rule.metadata,
  };
}

function normalizeValidationResult(
  result: DropPoolValidationResult,
): DropPoolValidationResult {
  return {
    ...result,
    valid: Boolean(result.valid),
    validation_errors: result.validation_errors ?? [],
    warnings: result.warnings ?? [],
  };
}

function readAdminError(error: unknown, fallback: string): PageError {
  if (error instanceof AdminApiError) {
    return {
      message: error.message || fallback,
      code: error.code,
      requestId: error.requestId ?? null,
    };
  }

  return {
    message: error instanceof Error ? error.message : fallback,
  };
}

function getItemLabel(item: DropPoolItem): string {
  return (
    item.template_display_name ??
    item.form_display_name ??
    item.template_slug ??
    shortId(item.template_id)
  );
}

function formatProbability(item: DropPoolItem, totalWeight: number | string) {
  const bps =
    normalizeNumber(item.probability_bps) ??
    computeProbabilityBps(item.drop_weight, totalWeight);

  if (bps === null) {
    return "-";
  }

  return `${(bps / 100).toFixed(2)}%`;
}

function computeProbabilityBps(
  weight: number | string,
  totalWeight: number | string,
): number | null {
  const normalizedWeight = normalizeNumber(weight);
  const normalizedTotalWeight = normalizeNumber(totalWeight);

  if (
    normalizedWeight === null ||
    normalizedTotalWeight === null ||
    normalizedTotalWeight <= 0
  ) {
    return null;
  }

  return (normalizedWeight / normalizedTotalWeight) * 10000;
}

function formatNumeric(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numeric = normalizeNumber(value);
  return numeric === null ? String(value) : numeric.toLocaleString();
}

function normalizeNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeNullableNumber(
  value: number | string | null | undefined,
): number | null {
  return normalizeNumber(value);
}

function normalizePositiveNumber(
  value: number | string,
  field: string,
): number {
  const numeric = normalizeNumber(value);

  if (numeric === null || numeric <= 0) {
    throw new Error(`${field} must be greater than 0`);
  }

  return numeric;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
