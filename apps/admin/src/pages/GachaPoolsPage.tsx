import {
  CheckCircle2,
  Copy,
  RefreshCw,
  Rocket,
  Save,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  cloneDropPoolVersion,
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

type BusyAction = "save" | "validate" | "publish" | "clone" | null;
type PageError = {
  message: string;
  code?: string;
  requestId?: string | null;
};
type ChangeKind = "added" | "removed" | "changed" | "unchanged";
type NumericDelta = {
  before: number | null;
  after: number | null;
  delta: number | null;
  changed: boolean;
};
type BooleanDelta = {
  before: boolean | null;
  after: boolean | null;
  changed: boolean;
};
type TextDelta = {
  before: string | null;
  after: string | null;
  changed: boolean;
};
type CompareItemDiff = {
  key: string;
  label: string;
  kind: ChangeKind;
  rarity: TextDelta;
  weight: NumericDelta;
  probabilityBps: NumericDelta;
  stockTotal: NumericDelta;
  stockRemaining: NumericDelta;
  pityEligible: BooleanDelta;
  highRiskReasons: string[];
};
type RarityProbabilityDiff = {
  rarityCode: string;
  beforeBps: number;
  afterBps: number;
  deltaBps: number;
  highRisk: boolean;
};
type PityRuleDiff = {
  key: string;
  label: string;
  kind: ChangeKind;
  threshold: NumericDelta;
  targetRarity: TextDelta;
  active: BooleanDelta;
  highRiskReasons: string[];
};
type DropPoolComparison = {
  activeVersion: DropPoolVersion;
  targetVersion: DropPoolVersion;
  itemDiffs: CompareItemDiff[];
  rarityDiffs: RarityProbabilityDiff[];
  pityDiffs: PityRuleDiff[];
  summary: {
    addedRewards: number;
    removedRewards: number;
    changedRewards: number;
    rarityChanges: number;
    stockChanges: number;
    pityChanges: number;
    highRiskCount: number;
  };
  loadedAt: string;
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
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [comparison, setComparison] = useState<DropPoolComparison | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
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
  const selectedVersionCloneable = selectedVersion
    ? isCloneableVersion(selectedVersion)
    : false;
  const selectedVersionValidatable =
    selectedVersion?.status === "draft" ||
    selectedVersion?.status === "scheduled";
  const selectedVersionPublishable =
    selectedVersion?.status === "draft" ||
    selectedVersion?.status === "scheduled";
  const currentComparison =
    comparison &&
    comparison.activeVersion.id === activeVersion?.id &&
    comparison.targetVersion.id === selectedVersion?.id
      ? comparison
      : null;

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

  async function loadComparisonForSelection(): Promise<DropPoolComparison | null> {
    if (!selectedBox || !selectedVersion || !activeVersion) {
      setError({ message: "请选择盲盒、目标版本，并确认存在 active 版本" });
      return null;
    }

    setLoadingComparison(true);
    setError(null);

    try {
      const [
        activeItemResponse,
        activePityResponse,
        targetItemResponse,
        targetPityResponse,
      ] = await Promise.all([
        fetchDropPoolItems({ poolVersionId: activeVersion.id, limit: 500 }),
        fetchPityRules({
          boxId: selectedBox.id,
          poolVersionId: activeVersion.id,
          limit: 50,
        }),
        fetchDropPoolItems({ poolVersionId: selectedVersion.id, limit: 500 }),
        fetchPityRules({
          boxId: selectedBox.id,
          poolVersionId: selectedVersion.id,
          limit: 50,
        }),
      ]);
      const nextComparison = buildDropPoolComparison({
        activeVersion,
        targetVersion: selectedVersion,
        activeItems: activeItemResponse.items,
        activePityRules: activePityResponse.items,
        targetItems: targetItemResponse.items,
        targetPityRules: targetPityResponse.items,
      });

      setComparison(nextComparison);
      return nextComparison;
    } catch (compareError) {
      const pageError = readAdminError(compareError, "概率版本对比加载失败");
      setComparison(null);
      setError(pageError);
      return null;
    } finally {
      setLoadingComparison(false);
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

  async function handleCompareActive() {
    const nextComparison = await loadComparisonForSelection();

    if (nextComparison) {
      setNotice(
        nextComparison.summary.highRiskCount > 0
          ? `对比完成：发现 ${nextComparison.summary.highRiskCount} 个高风险变化`
          : "对比完成：未发现高风险变化",
      );
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

      if (selectedBox) {
        await loadVersions(selectedBox.id);
      }
    } catch (validateError) {
      setError(readAdminError(validateError, "校验概率版本失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function openPublishConfirm() {
    if (!selectedVersion || !selectedVersionPublishable) {
      setError({ message: "请选择可发布的概率版本" });
      return;
    }

    if (activeVersion) {
      const nextComparison = await loadComparisonForSelection();

      if (!nextComparison) {
        return;
      }
    } else {
      setComparison(null);
    }

    setPublishConfirmOpen(true);
  }

  async function handlePublishConfirmed() {
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
      setPublishConfirmOpen(false);
      setComparison(null);

      if (selectedBox) {
        await loadVersions(selectedBox.id);
      }
    } catch (publishError) {
      setError(readAdminError(publishError, "发布概率版本失败"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleClone(version: DropPoolVersion) {
    if (!selectedBox) {
      setError({ message: "请选择盲盒" });
      return;
    }

    if (!isCloneableVersion(version)) {
      setError({ message: "只有 active / archived 版本可以克隆为草稿" });
      return;
    }

    const operationReason = reason.trim();

    if (!operationReason) {
      setError({ message: "克隆版本必须填写 reason" });
      return;
    }

    setBusyAction("clone");
    setError(null);
    setNotice(null);

    try {
      const result = await cloneDropPoolVersion({
        boxId: selectedBox.id,
        sourceVersionId: version.id,
        versionName: `clone-v${version.version_no}`,
        reason: operationReason,
      });

      setNotice(
        `已克隆为草稿${result.drop_pool_version_id ? ` / draft ${shortId(result.drop_pool_version_id)}` : ""}${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );

      await loadVersions(selectedBox.id);

      if (result.drop_pool_version_id) {
        setSelectedVersionId(result.drop_pool_version_id);
      }
    } catch (cloneError) {
      setError(readAdminError(cloneError, "克隆概率版本失败"));
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
    setComparison(null);
    setPublishConfirmOpen(false);
    setNotice(null);
  }

  function updateDraftItem(index: number, patch: Partial<DropPoolItem>) {
    setComparison(null);
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
                        <div className="list-row__actions">
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelectedVersionId(version.id);
                              setValidation(null);
                              setComparison(null);
                              setPublishConfirmOpen(false);
                            }}
                            type="button"
                          >
                            查看
                          </button>
                          {isCloneableVersion(version) ? (
                            <button
                              className="text-button"
                              disabled={busyAction === "clone"}
                              onClick={() => void handleClone(version)}
                              type="button"
                            >
                              克隆为草稿
                            </button>
                          ) : null}
                        </div>
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
                当前版本不是 draft，只允许查看；scheduled 可发布，active /
                archived 只能克隆为新草稿后编辑，disabled 只读。
              </p>
            ) : null}

            <div className="gacha-editor-actions">
              {selectedVersionCloneable && selectedVersion ? (
                <button
                  className="icon-button"
                  disabled={busyAction === "clone"}
                  onClick={() => void handleClone(selectedVersion)}
                  type="button"
                >
                  <Copy aria-hidden="true" size={16} />
                  <span>
                    {busyAction === "clone" ? "克隆中" : "克隆为草稿"}
                  </span>
                </button>
              ) : (
                <>
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
                    disabled={
                      !selectedVersion ||
                      !selectedVersionValidatable ||
                      busyAction === "validate"
                    }
                    onClick={() => void handleValidate()}
                    type="button"
                  >
                    <CheckCircle2 aria-hidden="true" size={16} />
                    <span>{busyAction === "validate" ? "校验中" : "校验"}</span>
                  </button>
                  <button
                    className="icon-button"
                    disabled={
                      !selectedVersion || !activeVersion || loadingComparison
                    }
                    onClick={() => void handleCompareActive()}
                    type="button"
                  >
                    <ShieldAlert aria-hidden="true" size={16} />
                    <span>{loadingComparison ? "对比中" : "对比 active"}</span>
                  </button>
                  <button
                    className="icon-button icon-button--danger"
                    disabled={
                      !selectedVersion ||
                      !selectedVersionPublishable ||
                      busyAction === "publish"
                    }
                    onClick={() => void openPublishConfirm()}
                    type="button"
                  >
                    <Rocket aria-hidden="true" size={16} />
                    <span>{busyAction === "publish" ? "发布中" : "发布"}</span>
                  </button>
                </>
              )}
            </div>

            <DropPoolItemsTable
              items={draftItems}
              loading={loadingItems}
              readOnly={selectedVersionReadOnly}
              totalWeight={selectedVersion?.total_weight ?? 0}
              updateDraftItem={updateDraftItem}
            />
          </section>

          <DropPoolComparePanel
            comparison={currentComparison}
            loading={loadingComparison}
          />

          <div className="split-grid split-grid--even">
            <PityRulesPanel rules={pityRules} />
            <ValidationPanel validation={validation} />
          </div>
        </div>
      </div>

      <PublishConfirmDialog
        comparison={currentComparison}
        isOpen={publishConfirmOpen}
        pending={busyAction === "publish"}
        reason={reason}
        selectedVersion={selectedVersion}
        onCancel={() => setPublishConfirmOpen(false)}
        onConfirm={() => void handlePublishConfirmed()}
        onReasonChange={setReason}
      />
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

function DropPoolComparePanel(props: {
  comparison: DropPoolComparison | null;
  loading: boolean;
}) {
  const changedItems =
    props.comparison?.itemDiffs.filter((item) => item.kind !== "unchanged") ??
    [];
  const changedRarities =
    props.comparison?.rarityDiffs.filter((item) => item.deltaBps !== 0) ?? [];
  const changedPityRules =
    props.comparison?.pityDiffs.filter((rule) => rule.kind !== "unchanged") ??
    [];

  return (
    <section className="detail-panel gacha-compare-panel">
      <div className="detail-panel__header">
        <div>
          <h2>概率版本对比</h2>
          <p>
            {props.comparison
              ? `active v${props.comparison.activeVersion.version_no} -> v${props.comparison.targetVersion.version_no} / ${formatDate(props.comparison.loadedAt)}`
              : "点击“对比 active”后展示新旧概率、稀有度概率、库存和保底变化"}
          </p>
        </div>
        <StatusBadge status={props.loading ? "processing" : "read"} />
      </div>

      {props.loading ? <p className="notice">对比数据加载中...</p> : null}
      {!props.loading && !props.comparison ? (
        <p className="muted">暂无对比数据</p>
      ) : null}

      {props.comparison ? (
        <div className="gacha-compare-stack">
          <ComparisonSummaryGrid comparison={props.comparison} />

          {props.comparison.summary.highRiskCount > 0 ? (
            <HighRiskList comparison={props.comparison} />
          ) : null}

          <div className="split-grid split-grid--even">
            <section className="gacha-compare-section">
              <h3>稀有度概率变化</h3>
              <div className="table-wrap table-wrap--small">
                <table>
                  <thead>
                    <tr>
                      <th>稀有度</th>
                      <th>active</th>
                      <th>目标版本</th>
                      <th>变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedRarities.map((rarity) => (
                      <tr
                        className={
                          rarity.highRisk ? "gacha-diff-row--risk" : undefined
                        }
                        key={rarity.rarityCode}
                      >
                        <td>
                          <StatusBadge status={rarity.rarityCode} />
                        </td>
                        <td>{formatBpsPercent(rarity.beforeBps)}</td>
                        <td>{formatBpsPercent(rarity.afterBps)}</td>
                        <td>{formatBpsDelta(rarity.deltaBps)}</td>
                      </tr>
                    ))}
                    {changedRarities.length === 0 ? (
                      <tr>
                        <td colSpan={4}>稀有度概率无变化</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="gacha-compare-section">
              <h3>保底规则变化</h3>
              <div className="table-wrap table-wrap--small">
                <table>
                  <thead>
                    <tr>
                      <th>规则</th>
                      <th>状态</th>
                      <th>次数</th>
                      <th>目标稀有度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedPityRules.map((rule) => (
                      <tr
                        className={
                          rule.highRiskReasons.length > 0
                            ? "gacha-diff-row--risk"
                            : undefined
                        }
                        key={rule.key}
                      >
                        <td>
                          <strong>{rule.label}</strong>
                          {rule.highRiskReasons.length > 0 ? (
                            <small>{rule.highRiskReasons.join(" / ")}</small>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge status={rule.kind} />
                        </td>
                        <td>{formatNumberDelta(rule.threshold)}</td>
                        <td>{formatTextDelta(rule.targetRarity)}</td>
                      </tr>
                    ))}
                    {changedPityRules.length === 0 ? (
                      <tr>
                        <td colSpan={4}>保底规则无变化</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="gacha-compare-section">
            <h3>奖励项差异</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>奖励</th>
                    <th>状态</th>
                    <th>稀有度</th>
                    <th>权重</th>
                    <th>概率</th>
                    <th>库存</th>
                    <th>保底 eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {changedItems.map((item) => (
                    <tr
                      className={
                        item.highRiskReasons.length > 0
                          ? "gacha-diff-row--risk"
                          : undefined
                      }
                      key={item.key}
                    >
                      <td>
                        <strong>{item.label}</strong>
                        {item.highRiskReasons.length > 0 ? (
                          <small>{item.highRiskReasons.join(" / ")}</small>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge status={item.kind} />
                      </td>
                      <td>{formatTextDelta(item.rarity)}</td>
                      <td>{formatNumberDelta(item.weight)}</td>
                      <td>{formatBpsDeltaRange(item.probabilityBps)}</td>
                      <td>{formatStockDelta(item)}</td>
                      <td>{formatBooleanDelta(item.pityEligible)}</td>
                    </tr>
                  ))}
                  {changedItems.length === 0 ? (
                    <tr>
                      <td colSpan={7}>奖励项无变化</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ComparisonSummaryGrid({
  comparison,
}: {
  comparison: DropPoolComparison;
}) {
  return (
    <div className="gacha-compare-summary">
      <DetailItem
        label="奖励变化"
        value={`+${comparison.summary.addedRewards} / -${comparison.summary.removedRewards} / 改 ${comparison.summary.changedRewards}`}
      />
      <DetailItem
        label="稀有度变化"
        value={String(comparison.summary.rarityChanges)}
      />
      <DetailItem
        label="库存变化"
        value={String(comparison.summary.stockChanges)}
      />
      <DetailItem
        label="保底变化"
        value={String(comparison.summary.pityChanges)}
      />
      <DetailItem
        label="高风险变化"
        value={String(comparison.summary.highRiskCount)}
      />
    </div>
  );
}

function HighRiskList({ comparison }: { comparison: DropPoolComparison }) {
  const messages = getHighRiskMessages(comparison);

  return (
    <div className="gacha-risk-list">
      <span className="gacha-risk-list__icon">
        <ShieldAlert aria-hidden="true" size={18} />
      </span>
      <div>
        <strong>高风险变化</strong>
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PublishConfirmDialog(props: {
  comparison: DropPoolComparison | null;
  isOpen: boolean;
  pending: boolean;
  reason: string;
  selectedVersion: DropPoolVersion | null;
  onCancel: () => void;
  onConfirm: () => void;
  onReasonChange: (value: string) => void;
}) {
  if (!props.isOpen) {
    return null;
  }

  const reasonReady = props.reason.trim().length > 0;

  return (
    <div className="danger-dialog-backdrop" role="presentation">
      <form
        aria-modal="true"
        className="danger-dialog gacha-publish-dialog"
        onSubmit={(event) => {
          event.preventDefault();

          if (reasonReady) {
            props.onConfirm();
          }
        }}
        role="dialog"
      >
        <div className="danger-dialog__header">
          <span className="danger-dialog__icon">
            <ShieldAlert aria-hidden="true" size={20} />
          </span>
          <div>
            <h2>确认发布概率版本</h2>
            <p>
              {props.selectedVersion
                ? `目标版本 v${props.selectedVersion.version_no} / ${shortId(props.selectedVersion.id)}`
                : "未选择目标版本"}
            </p>
          </div>
          <button
            className="icon-only-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            ×
          </button>
        </div>

        {props.comparison ? (
          <>
            <ComparisonSummaryGrid comparison={props.comparison} />
            {props.comparison.summary.highRiskCount > 0 ? (
              <HighRiskList comparison={props.comparison} />
            ) : (
              <p className="notice">差异摘要未发现高风险变化。</p>
            )}
          </>
        ) : (
          <p className="notice">
            当前没有 active 版本可对比；发布将以后台 RPC 校验结果为准。
          </p>
        )}

        <label>
          <span>发布 reason</span>
          <textarea
            disabled={props.pending}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="说明本次概率、库存或保底调整原因"
            rows={3}
            value={props.reason}
          />
        </label>

        {!reasonReady ? (
          <p className="notice notice--error">发布前必须填写 reason</p>
        ) : null}

        <div className="button-row">
          <button
            className="text-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="icon-button icon-button--danger"
            disabled={props.pending || !reasonReady}
            type="submit"
          >
            <Rocket aria-hidden="true" size={16} />
            <span>{props.pending ? "发布中" : "确认发布"}</span>
          </button>
        </div>
      </form>
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

function buildDropPoolComparison(input: {
  activeVersion: DropPoolVersion;
  targetVersion: DropPoolVersion;
  activeItems: DropPoolItem[];
  activePityRules: PityRule[];
  targetItems: DropPoolItem[];
  targetPityRules: PityRule[];
}): DropPoolComparison {
  const itemDiffs = buildItemDiffs(input);
  const rarityDiffs = buildRarityDiffs(input);
  const pityDiffs = buildPityDiffs(
    input.activePityRules,
    input.targetPityRules,
  );
  const stockChanges = itemDiffs.filter(
    (item) => item.stockRemaining.changed || item.stockTotal.changed,
  ).length;
  const highRiskCount =
    itemDiffs.filter((item) => item.highRiskReasons.length > 0).length +
    rarityDiffs.filter((rarity) => rarity.highRisk).length +
    pityDiffs.filter((rule) => rule.highRiskReasons.length > 0).length;

  return {
    activeVersion: input.activeVersion,
    targetVersion: input.targetVersion,
    itemDiffs,
    rarityDiffs,
    pityDiffs,
    summary: {
      addedRewards: itemDiffs.filter((item) => item.kind === "added").length,
      removedRewards: itemDiffs.filter((item) => item.kind === "removed")
        .length,
      changedRewards: itemDiffs.filter((item) => item.kind === "changed")
        .length,
      rarityChanges: rarityDiffs.filter((rarity) => rarity.deltaBps !== 0)
        .length,
      stockChanges,
      pityChanges: pityDiffs.filter((rule) => rule.kind !== "unchanged").length,
      highRiskCount,
    },
    loadedAt: new Date().toISOString(),
  };
}

function buildItemDiffs(input: {
  activeVersion: DropPoolVersion;
  targetVersion: DropPoolVersion;
  activeItems: DropPoolItem[];
  targetItems: DropPoolItem[];
}): CompareItemDiff[] {
  const activeItemsByKey = indexItemsByRewardKey(input.activeItems);
  const targetItemsByKey = indexItemsByRewardKey(input.targetItems);
  const keys = Array.from(
    new Set([...activeItemsByKey.keys(), ...targetItemsByKey.keys()]),
  );

  return keys
    .map((key) => {
      const before = activeItemsByKey.get(key) ?? null;
      const after = targetItemsByKey.get(key) ?? null;
      const rarity = textDelta(
        before?.rarity_code ?? null,
        after?.rarity_code ?? null,
      );
      const weight = numberDelta(before?.drop_weight, after?.drop_weight);
      const probabilityBps = numberDelta(
        before ? readItemProbabilityBps(before, input.activeVersion) : null,
        after ? readItemProbabilityBps(after, input.targetVersion) : null,
      );
      const stockTotal = numberDelta(
        before?.stock_total ?? null,
        after?.stock_total ?? null,
      );
      const stockRemaining = numberDelta(
        before?.stock_remaining ?? null,
        after?.stock_remaining ?? null,
      );
      const pityEligible = booleanDelta(
        before?.is_pity_eligible ?? null,
        after?.is_pity_eligible ?? null,
      );
      const kind = readChangeKind(
        [
          rarity.changed,
          weight.changed,
          probabilityBps.changed,
          stockTotal.changed,
          stockRemaining.changed,
          pityEligible.changed,
        ],
        before,
        after,
      );
      const highRiskReasons: string[] = [];

      if (isDecrease(stockTotal)) {
        highRiskReasons.push("库存上限减少");
      }

      if (isDecrease(stockRemaining)) {
        highRiskReasons.push("剩余库存减少");
      }

      if (before && !after && isLegendaryRarity(before.rarity_code)) {
        highRiskReasons.push("Legendary 奖励删除");
      }

      if (
        before?.is_pity_eligible === true &&
        after?.is_pity_eligible === false
      ) {
        highRiskReasons.push("保底 eligible 关闭");
      }

      return {
        key,
        label: getItemLabel(after ?? before ?? fallbackDropPoolItem(key)),
        kind,
        rarity,
        weight,
        probabilityBps,
        stockTotal,
        stockRemaining,
        pityEligible,
        highRiskReasons,
      };
    })
    .sort(compareItemDiffs);
}

function buildRarityDiffs(input: {
  activeVersion: DropPoolVersion;
  targetVersion: DropPoolVersion;
  activeItems: DropPoolItem[];
  targetItems: DropPoolItem[];
}): RarityProbabilityDiff[] {
  const activeByRarity = summarizeProbabilityByRarity(
    input.activeItems,
    input.activeVersion,
  );
  const targetByRarity = summarizeProbabilityByRarity(
    input.targetItems,
    input.targetVersion,
  );
  const rarityCodes = Array.from(
    new Set([...activeByRarity.keys(), ...targetByRarity.keys()]),
  ).sort();

  return rarityCodes.map((rarityCode) => {
    const beforeBps = activeByRarity.get(rarityCode) ?? 0;
    const afterBps = targetByRarity.get(rarityCode) ?? 0;
    const deltaBps = normalizeBps(afterBps - beforeBps);

    return {
      rarityCode,
      beforeBps,
      afterBps,
      deltaBps,
      highRisk: isLegendaryRarity(rarityCode) && deltaBps < 0,
    };
  });
}

function buildPityDiffs(
  activeRules: PityRule[],
  targetRules: PityRule[],
): PityRuleDiff[] {
  const activeRulesByKey = indexPityRulesByKey(activeRules);
  const targetRulesByKey = indexPityRulesByKey(targetRules);
  const keys = Array.from(
    new Set([...activeRulesByKey.keys(), ...targetRulesByKey.keys()]),
  );

  return keys
    .map((key) => {
      const before = activeRulesByKey.get(key) ?? null;
      const after = targetRulesByKey.get(key) ?? null;
      const threshold = numberDelta(
        before?.threshold ?? null,
        after?.threshold ?? null,
      );
      const targetRarity = textDelta(
        before?.target_rarity_code ?? null,
        after?.target_rarity_code ?? null,
      );
      const active = booleanDelta(
        before?.active ?? null,
        after?.active ?? null,
      );
      const kind = readChangeKind(
        [threshold.changed, targetRarity.changed, active.changed],
        before,
        after,
      );
      const highRiskReasons: string[] = [];

      if (threshold.delta !== null && threshold.delta > 0) {
        highRiskReasons.push("保底次数增加");
      }

      return {
        key,
        label: after?.rule_name ?? before?.rule_name ?? key,
        kind,
        threshold,
        targetRarity,
        active,
        highRiskReasons,
      };
    })
    .sort(comparePityDiffs);
}

function indexItemsByRewardKey(
  items: DropPoolItem[],
): Map<string, DropPoolItem> {
  return new Map(items.map((item) => [readRewardKey(item), item]));
}

function indexPityRulesByKey(rules: PityRule[]): Map<string, PityRule> {
  return new Map(rules.map((rule) => [readPityRuleKey(rule), rule]));
}

function readRewardKey(item: DropPoolItem): string {
  return `${item.template_id}:${item.form_id ?? "no-form"}`;
}

function readPityRuleKey(rule: PityRule): string {
  return [
    rule.rule_name.trim().toLowerCase(),
    rule.target_rarity_code,
    rule.guaranteed_template_id ?? "no-template",
    rule.guaranteed_form_id ?? "no-form",
  ].join(":");
}

function summarizeProbabilityByRarity(
  items: DropPoolItem[],
  version: DropPoolVersion,
): Map<string, number> {
  const summary = new Map<string, number>();

  for (const item of items) {
    const bps = readItemProbabilityBps(item, version) ?? 0;
    summary.set(
      item.rarity_code,
      normalizeBps((summary.get(item.rarity_code) ?? 0) + bps),
    );
  }

  return summary;
}

function readItemProbabilityBps(
  item: DropPoolItem,
  version: DropPoolVersion,
): number | null {
  const explicitBps = normalizeNumber(item.probability_bps);

  if (explicitBps !== null) {
    return normalizeBps(explicitBps);
  }

  const computedBps = computeProbabilityBps(
    item.drop_weight,
    version.total_weight,
  );
  return computedBps === null ? null : normalizeBps(computedBps);
}

function numberDelta(
  beforeValue: number | string | null | undefined,
  afterValue: number | string | null | undefined,
): NumericDelta {
  const before = normalizeNumber(beforeValue);
  const after = normalizeNumber(afterValue);
  const changed = !sameNullableNumber(before, after);

  return {
    before,
    after,
    delta:
      before === null || after === null ? null : normalizeBps(after - before),
    changed,
  };
}

function textDelta(
  beforeValue: string | null | undefined,
  afterValue: string | null | undefined,
): TextDelta {
  const before = beforeValue?.trim() ? beforeValue.trim() : null;
  const after = afterValue?.trim() ? afterValue.trim() : null;

  return {
    before,
    after,
    changed: before !== after,
  };
}

function booleanDelta(
  before: boolean | null,
  after: boolean | null,
): BooleanDelta {
  return {
    before,
    after,
    changed: before !== after,
  };
}

function readChangeKind(
  changedFields: boolean[],
  before: unknown,
  after: unknown,
): ChangeKind {
  if (!before && after) {
    return "added";
  }

  if (before && !after) {
    return "removed";
  }

  return changedFields.some(Boolean) ? "changed" : "unchanged";
}

function isDecrease(delta: NumericDelta): boolean {
  return (
    delta.before !== null && delta.after !== null && delta.after < delta.before
  );
}

function compareItemDiffs(a: CompareItemDiff, b: CompareItemDiff): number {
  const riskDelta = b.highRiskReasons.length - a.highRiskReasons.length;

  if (riskDelta !== 0) {
    return riskDelta;
  }

  const order: Record<ChangeKind, number> = {
    added: 0,
    removed: 1,
    changed: 2,
    unchanged: 3,
  };

  return order[a.kind] - order[b.kind] || a.label.localeCompare(b.label);
}

function comparePityDiffs(a: PityRuleDiff, b: PityRuleDiff): number {
  const riskDelta = b.highRiskReasons.length - a.highRiskReasons.length;

  if (riskDelta !== 0) {
    return riskDelta;
  }

  return a.label.localeCompare(b.label);
}

function getHighRiskMessages(comparison: DropPoolComparison): string[] {
  const messages = [
    ...comparison.rarityDiffs
      .filter((rarity) => rarity.highRisk)
      .map(
        (rarity) =>
          `${rarity.rarityCode} 概率降低：${formatBpsPercent(
            rarity.beforeBps,
          )} -> ${formatBpsPercent(rarity.afterBps)}`,
      ),
    ...comparison.itemDiffs
      .filter((item) => item.highRiskReasons.length > 0)
      .map((item) => `${item.label}: ${item.highRiskReasons.join(" / ")}`),
    ...comparison.pityDiffs
      .filter((rule) => rule.highRiskReasons.length > 0)
      .map((rule) => `${rule.label}: ${rule.highRiskReasons.join(" / ")}`),
  ];
  const uniqueMessages = Array.from(new Set(messages));

  if (uniqueMessages.length <= 8) {
    return uniqueMessages;
  }

  return [
    ...uniqueMessages.slice(0, 8),
    `还有 ${uniqueMessages.length - 8} 个高风险变化`,
  ];
}

function formatNumberDelta(delta: NumericDelta): string {
  if (!delta.changed) {
    return formatNullableNumber(delta.after ?? delta.before);
  }

  return `${formatNullableNumber(delta.before)} -> ${formatNullableNumber(
    delta.after,
  )}${delta.delta === null ? "" : ` (${formatSignedNumber(delta.delta)})`}`;
}

function formatTextDelta(delta: TextDelta): string {
  if (!delta.changed) {
    return delta.after ?? delta.before ?? "-";
  }

  return `${delta.before ?? "-"} -> ${delta.after ?? "-"}`;
}

function formatBooleanDelta(delta: BooleanDelta): string {
  if (!delta.changed) {
    return formatNullableBoolean(delta.after ?? delta.before);
  }

  return `${formatNullableBoolean(delta.before)} -> ${formatNullableBoolean(
    delta.after,
  )}`;
}

function formatBpsDeltaRange(delta: NumericDelta): string {
  if (!delta.changed) {
    return delta.after === null && delta.before === null
      ? "-"
      : formatBpsPercent(delta.after ?? delta.before ?? 0);
  }

  return `${formatNullableBpsPercent(delta.before)} -> ${formatNullableBpsPercent(
    delta.after,
  )}${delta.delta === null ? "" : ` (${formatBpsDelta(delta.delta)})`}`;
}

function formatStockDelta(item: CompareItemDiff): string {
  const before = formatStockPair(
    item.stockRemaining.before,
    item.stockTotal.before,
  );
  const after = formatStockPair(
    item.stockRemaining.after,
    item.stockTotal.after,
  );

  if (!item.stockRemaining.changed && !item.stockTotal.changed) {
    return after === "- / -" ? before : after;
  }

  return `${before} -> ${after}`;
}

function formatStockPair(
  remaining: number | null,
  total: number | null,
): string {
  return `${formatNullableNumber(remaining)} / ${formatNullableNumber(total)}`;
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumeric(value);
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) {
    return "-";
  }

  return value ? "yes" : "no";
}

function formatNullableBpsPercent(value: number | null): string {
  return value === null ? "-" : formatBpsPercent(value);
}

function formatBpsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatBpsDelta(deltaBps: number): string {
  const sign = deltaBps > 0 ? "+" : "";
  return `${sign}${(deltaBps / 100).toFixed(2)}pp`;
}

function formatSignedNumber(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumeric(value)}`;
}

function sameNullableNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return Math.abs(a - b) < 0.0001;
}

function normalizeBps(value: number): number {
  return Number(value.toFixed(4));
}

function isLegendaryRarity(value: string | null | undefined): boolean {
  return value?.toLowerCase() === "legendary";
}

function fallbackDropPoolItem(key: string): DropPoolItem {
  return {
    id: key,
    pool_version_id: "",
    template_id: key,
    form_id: null,
    rarity_code: "",
    drop_weight: 0,
    probability_bps: null,
    stock_total: null,
    stock_remaining: null,
    is_pity_eligible: false,
    is_featured: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
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

function isCloneableVersion(version: DropPoolVersion): boolean {
  return version.status === "active" || version.status === "archived";
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
