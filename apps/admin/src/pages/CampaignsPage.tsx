import { Image as ImageIcon, Plus, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchCampaigns,
  publishAdminStorageUpload,
  upsertCampaign,
} from "../admin.api";
import type {
  AdminStorageSignedUpload,
  BannerCampaign,
  CampaignsResponse,
  UpsertCampaignInput,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { ImageUploader } from "../components/ImageUploader";

const CAMPAIGN_PLACEMENTS = [
  "",
  "market_top",
  "task_top",
  "box_top",
  "home_top",
  "album_top",
];
const CAMPAIGN_TARGET_TYPES = [
  "none",
  "box",
  "listing",
  "task",
  "payment",
  "external",
];
const CAMPAIGN_STATUSES = ["", "draft", "active", "paused", "ended"];
const PREVIEW_STATUSES = [
  "not_started",
  "active",
  "paused",
  "sold_out",
  "ended",
];

type CampaignDraft = {
  id?: string;
  code: string;
  title: string;
  description: string;
  image_url: string;
  placement: string;
  target_type: string;
  target_ref: string;
  target_payload: string;
  status: string;
  starts_at: string;
  ends_at: string;
  sort_order: string;
  metadata: string;
};

export function CampaignsPage() {
  const [placement, setPlacement] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CampaignsResponse | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    createEmptyCampaignDraft(),
  );
  const [pendingUpload, setPendingUpload] =
    useState<AdminStorageSignedUpload | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const campaigns = data?.items ?? [];
  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
      campaigns[0] ??
      null
    );
  }, [campaigns, selectedCampaignId]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchCampaigns({
        placement: placement || undefined,
        status: status || undefined,
        q: query || undefined,
        limit: 50,
      });

      setData(response);
      setSelectedCampaignId((current) =>
        current && response.items.some((campaign) => campaign.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(readError(loadError, "活动 Banner 加载失败"));
      setData(null);
      setSelectedCampaignId(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const operationReason = reason.trim();

    if (!operationReason) {
      setError("保存活动必须填写 reason");
      return;
    }

    let saveDraft = draft;
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (pendingUpload) {
        const published = await publishAdminStorageUpload({
          targetBucket: "banners",
          tempPath: pendingUpload.tempPath,
          reason: operationReason,
        });
        saveDraft = {
          ...draft,
          image_url: published.publicUrl,
        };
        setDraft(saveDraft);
        setPendingUpload(null);
      }

      const input = serializeCampaignDraft(saveDraft, operationReason);
      const result = await upsertCampaign(input);
      setNotice(
        `活动已提交${result.audit_log_id ? ` / audit ${shortId(result.audit_log_id)}` : ""}`,
      );
      await load();
    } catch (serializeError) {
      setError(readError(serializeError, "活动保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function selectCampaign(campaign: BannerCampaign) {
    setSelectedCampaignId(campaign.id);
    setDraft(toCampaignDraft(campaign));
    setPendingUpload(null);
    setNotice(null);
    setError(null);
  }

  function createDraft() {
    setSelectedCampaignId(null);
    setDraft(createEmptyCampaignDraft());
    setPendingUpload(null);
    setNotice(null);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, [placement, status]);

  useEffect(() => {
    if (selectedCampaign) {
      setDraft(toCampaignDraft(selectedCampaign));
    } else if (!selectedCampaignId) {
      setDraft(createEmptyCampaignDraft());
    }
  }, [selectedCampaign, selectedCampaignId]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>Placement</span>
          <select
            onChange={(event) => setPlacement(event.target.value)}
            value={placement}
          >
            {CAMPAIGN_PLACEMENTS.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            {CAMPAIGN_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>活动 code / title</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="campaign code or title"
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
        <button className="icon-button" onClick={createDraft} type="button">
          <Plus aria-hidden="true" size={17} />
          <span>新建草稿</span>
        </button>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <PreviewStatusStrip />

      <div className="split-grid">
        <section className="admin-surface">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>活动</th>
                  <th>Placement</th>
                  <th>图片</th>
                  <th>时间窗口</th>
                  <th>Target</th>
                  <th>状态</th>
                  <th>排序</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr
                    className={
                      selectedCampaign?.id === campaign.id ? "is-selected" : ""
                    }
                    key={campaign.id}
                  >
                    <td>
                      <strong>{campaign.title}</strong>
                      <small>{campaign.code}</small>
                    </td>
                    <td>{campaign.placement}</td>
                    <td>
                      <CampaignThumb campaign={campaign} />
                    </td>
                    <td>
                      <strong>{formatDate(campaign.starts_at)}</strong>
                      <small>{formatDate(campaign.ends_at)}</small>
                    </td>
                    <td>
                      <strong>{campaign.target_type}</strong>
                      <small>{campaign.target_ref ?? "-"}</small>
                    </td>
                    <td>
                      <StatusBadge
                        status={getCampaignPreviewStatus(campaign)}
                      />
                    </td>
                    <td>{campaign.sort_order}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => selectCampaign(campaign)}
                        type="button"
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={8}>暂无活动 Banner</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="detail-panel config-editor">
          <div className="detail-panel__header">
            <div>
              <h2>{draft.id ? "编辑活动" : "新建活动草稿"}</h2>
              <p>{draft.id ? shortId(draft.id) : "new campaign draft"}</p>
            </div>
            <StatusBadge
              status={getCampaignDraftPreviewStatus(draft) || "draft"}
            />
          </div>

          <CampaignPreview
            draft={draft}
            previewUrl={pendingUpload?.previewUrl ?? null}
          />

          <ImageUploader
            disabled={saving}
            label="Banner 素材"
            onError={setError}
            onUploaded={(upload) => {
              setPendingUpload(upload);
              setNotice(
                "素材已上传到 admin-temp，保存活动时会发布到 banners。",
              );
            }}
            previewUrl={pendingUpload?.previewUrl ?? draft.image_url}
            targetBucket="banners"
          />

          <div className="form-grid form-grid--compact">
            <label>
              <span>Code</span>
              <input
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                value={draft.code}
              />
            </label>
            <label>
              <span>Title</span>
              <input
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                value={draft.title}
              />
            </label>
            <label>
              <span>Placement</span>
              <select
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    placement: event.target.value,
                  }))
                }
                value={draft.placement}
              >
                {CAMPAIGN_PLACEMENTS.filter(Boolean).map((item) => (
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
                {CAMPAIGN_STATUSES.filter(Boolean).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-grid__wide">
              <span>Image URL</span>
              <input
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    image_url: event.target.value,
                  }))
                }
                value={draft.image_url}
              />
            </label>
            <label>
              <span>Target type</span>
              <select
                onChange={(event) =>
                  setDraft((current) => {
                    const targetType = event.target.value;

                    return {
                      ...current,
                      target_type: targetType,
                      target_payload: defaultTargetPayloadJson(
                        targetType,
                        current.target_ref,
                      ),
                    };
                  })
                }
                value={draft.target_type}
              >
                {CAMPAIGN_TARGET_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target ref</span>
              <input
                onChange={(event) =>
                  setDraft((current) => {
                    const targetRef = event.target.value;

                    return {
                      ...current,
                      target_ref: targetRef,
                      target_payload: defaultTargetPayloadJson(
                        current.target_type,
                        targetRef,
                      ),
                    };
                  })
                }
                value={draft.target_ref}
              />
            </label>
            <label className="form-grid__wide">
              <span>Target payload JSON</span>
              <textarea
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    target_payload: event.target.value,
                  }))
                }
                value={draft.target_payload}
              />
            </label>
            <label>
              <span>开始时间</span>
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
                placeholder="保存活动配置必填"
                value={reason}
              />
            </label>
          </div>

          <div className="button-row">
            <button
              className="icon-button"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              <Save aria-hidden="true" size={16} />
              <span>
                {saving
                  ? "保存中"
                  : pendingUpload
                    ? "发布素材并保存"
                    : "保存活动"}
              </span>
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function CampaignThumb({ campaign }: { campaign: BannerCampaign }) {
  if (!campaign.image_url) {
    return (
      <span className="admin-thumb admin-thumb--empty">
        <ImageIcon aria-hidden="true" size={16} />
      </span>
    );
  }

  return (
    <img
      alt={campaign.title}
      className="admin-thumb"
      loading="lazy"
      src={campaign.image_url}
    />
  );
}

function CampaignPreview({
  draft,
  previewUrl,
}: {
  draft: CampaignDraft;
  previewUrl?: string | null;
}) {
  const imageUrl = previewUrl ?? draft.image_url;

  return (
    <div className="campaign-preview" aria-label="Campaign preview">
      {imageUrl ? (
        <img alt={draft.title || "campaign preview"} src={imageUrl} />
      ) : (
        <span>
          <ImageIcon aria-hidden="true" size={24} />
        </span>
      )}
      <div>
        <strong>{draft.title || "Untitled campaign"}</strong>
        <small>
          {draft.placement} / {draft.target_type}
        </small>
      </div>
    </div>
  );
}

function PreviewStatusStrip() {
  return (
    <div className="metric-strip status-preview-strip">
      {PREVIEW_STATUSES.map((status) => (
        <span key={status}>
          <small>Preview</small>
          <strong>{status}</strong>
        </span>
      ))}
    </div>
  );
}

function createEmptyCampaignDraft(): CampaignDraft {
  return {
    code: "",
    title: "",
    description: "",
    image_url: "",
    placement: "market_top",
    target_type: "none",
    target_ref: "",
    target_payload: "{}",
    status: "draft",
    starts_at: "",
    ends_at: "",
    sort_order: "100",
    metadata: "{}",
  };
}

function toCampaignDraft(campaign: BannerCampaign): CampaignDraft {
  return {
    id: campaign.id,
    code: campaign.code,
    title: campaign.title,
    description: campaign.description ?? "",
    image_url: campaign.image_url,
    placement: campaign.placement,
    target_type: campaign.target_type,
    target_ref: campaign.target_ref ?? "",
    target_payload: JSON.stringify(
      campaign.target_payload ??
        deriveTargetPayload(campaign.target_type, campaign.target_ref ?? ""),
      null,
      2,
    ),
    status: campaign.status,
    starts_at: toDateTimeLocal(campaign.starts_at),
    ends_at: toDateTimeLocal(campaign.ends_at),
    sort_order: String(campaign.sort_order),
    metadata: JSON.stringify(campaign.metadata ?? {}, null, 2),
  };
}

function serializeCampaignDraft(
  draft: CampaignDraft,
  reason: string,
): UpsertCampaignInput {
  const code = draft.code.trim();
  const title = draft.title.trim();
  const imageUrl = draft.image_url.trim();
  const sortOrder = Number.parseInt(draft.sort_order, 10);
  const metadata = parseJsonObject(draft.metadata, "metadata");
  const targetPayload = parseJsonObject(draft.target_payload, "target_payload");
  const startsAt = toIsoOrNull(draft.starts_at);
  const endsAt = toIsoOrNull(draft.ends_at);
  const targetRef = draft.target_ref.trim() || null;

  if (!code || !title || !imageUrl) {
    throw new Error("code、title、image_url 为必填项");
  }

  if (!Number.isFinite(sortOrder)) {
    throw new Error("sort_order 必须是整数");
  }

  assertValidTimeWindow(startsAt, endsAt);

  const input: UpsertCampaignInput = {
    code,
    title,
    description: draft.description.trim() || null,
    image_url: imageUrl,
    placement: draft.placement,
    target_type: draft.target_type,
    target_ref: targetRef,
    target_payload:
      Object.keys(targetPayload).length > 0
        ? targetPayload
        : deriveTargetPayload(draft.target_type, targetRef ?? ""),
    status: draft.status,
    starts_at: startsAt,
    ends_at: endsAt,
    sort_order: sortOrder,
    metadata,
    reason,
  };

  if (draft.id) {
    input.id = draft.id;
  }

  return input;
}

function getCampaignPreviewStatus(campaign: BannerCampaign): string {
  return getWindowPreviewStatus({
    status: campaign.status,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
  });
}

function getCampaignDraftPreviewStatus(draft: CampaignDraft): string {
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

  if (input.status === "paused" || input.status === "ended") {
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

function parseJsonObject(
  value: string,
  field: string,
): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field} 必须是 JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function defaultTargetPayloadJson(
  targetType: string,
  targetRef: string,
): string {
  return JSON.stringify(deriveTargetPayload(targetType, targetRef), null, 2);
}

function deriveTargetPayload(
  targetType: string,
  targetRef: string,
): Record<string, unknown> {
  const ref = targetRef.trim();

  if (!ref) {
    return {};
  }

  switch (targetType) {
    case "box":
      return { box_id: ref };
    case "listing":
      return { listing_id: ref };
    case "task":
      return { task_ref: ref };
    case "payment":
      return { star_order_id: ref };
    case "external":
      return { url: ref };
    default:
      return {};
  }
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
