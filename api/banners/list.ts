import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";

type BannerPlacement =
  | "market_top"
  | "task_top"
  | "box_top"
  | "home_top"
  | "album_top";
type BannerTargetType =
  | "box"
  | "listing"
  | "task"
  | "payment"
  | "external"
  | "none";

type BannerRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  image_url: string;
  placement: string;
  target_type: string;
  target_ref: string | null;
  target_payload: unknown;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

const BANNER_PLACEMENTS: readonly BannerPlacement[] = [
  "market_top",
  "task_top",
  "box_top",
  "home_top",
  "album_top",
];

const BANNER_COLUMNS = [
  "id",
  "code",
  "title",
  "description",
  "image_url",
  "placement",
  "target_type",
  "target_ref",
  "target_payload",
  "sort_order",
  "starts_at",
  "ends_at",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    const placement = normalizePlacement(firstQueryValue(req.query.placement));
    const limit = normalizeLimit(firstQueryValue(req.query.limit));
    const serverTime = new Date();

    const { data, error } = await getSupabaseAdminClient()
      .schema("catalog")
      .from("banner_campaigns")
      .select(BANNER_COLUMNS)
      .eq("placement", placement)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(Math.min(limit * 4, 50));

    if (error) {
      throw new ApiError(
        500,
        "BANNER_LIST_FAILED",
        "活动 Banner 读取失败，请稍后重试。",
        {
          cause: error,
          expose: false,
        },
      );
    }

    const items = ((data ?? []) as unknown as BannerRow[])
      .filter((row) => isBannerVisibleAt(row, serverTime))
      .slice(0, limit)
      .map(mapBannerRow);

    return {
      items,
      placement,
      serverTime: serverTime.toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "banners.list",
    },
  },
);

function mapBannerRow(row: BannerRow) {
  const targetType = normalizeTargetType(row.target_type);
  const targetRef = resolveTargetRef(row, targetType);
  const targetPayload = normalizeTargetPayload(row.target_payload);

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    image_url: row.image_url,
    placement: row.placement,
    targetType,
    target_type: targetType,
    targetRef: targetRef,
    target_ref: targetRef,
    targetPayload,
    target_payload: targetPayload,
    targetHref: buildTargetHref(targetType, targetRef),
    target_href: buildTargetHref(targetType, targetRef),
    sortOrder: Number(row.sort_order),
    sort_order: Number(row.sort_order),
    startsAt: row.starts_at,
    starts_at: row.starts_at,
    endsAt: row.ends_at,
    ends_at: row.ends_at,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

function buildTargetHref(
  targetType: BannerTargetType,
  targetRef: string | null,
): string | null {
  if (!targetRef || targetType === "none") {
    return null;
  }

  switch (targetType) {
    case "box":
      return `/box?boxId=${encodeURIComponent(targetRef)}`;
    case "listing":
      return `/trade?tab=buy&listingId=${encodeURIComponent(targetRef)}`;
    case "task":
      return `/tasks?task=${encodeURIComponent(targetRef)}`;
    case "payment":
      return `/box?paymentOrderId=${encodeURIComponent(targetRef)}`;
    case "external":
      return targetRef.startsWith("https://") ? targetRef : null;
  }
}

function normalizeTargetType(value: string): BannerTargetType {
  switch (value) {
    case "box":
    case "listing":
    case "task":
    case "payment":
    case "external":
    case "none":
      return value;
    case "market_listing":
      return "listing";
    case "external_url":
      return "external";
    default:
      return "none";
  }
}

function resolveTargetRef(
  row: BannerRow,
  targetType: BannerTargetType,
): string | null {
  const targetRef = row.target_ref?.trim();

  if (targetRef) {
    return targetRef;
  }

  const payload = normalizeTargetPayload(row.target_payload);

  switch (targetType) {
    case "box":
      return readString(payload.box_id) ?? readString(payload.id);
    case "listing":
      return readString(payload.listing_id) ?? readString(payload.id);
    case "task":
      return (
        readString(payload.task_id) ??
        readString(payload.task_code) ??
        readString(payload.task_ref) ??
        readString(payload.id) ??
        readString(payload.code)
      );
    case "payment":
      return (
        readString(payload.star_order_id) ??
        readString(payload.payment_order_id) ??
        readString(payload.id)
      );
    case "external":
      return readString(payload.url) ?? readString(payload.href);
    case "none":
      return null;
  }
}

function normalizeTargetPayload(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBannerVisibleAt(row: BannerRow, now: Date): boolean {
  const startsAt = row.starts_at ? Date.parse(row.starts_at) : null;
  const endsAt = row.ends_at ? Date.parse(row.ends_at) : null;
  const nowMs = now.getTime();

  if (startsAt !== null && Number.isFinite(startsAt) && startsAt > nowMs) {
    return false;
  }

  if (endsAt !== null && Number.isFinite(endsAt) && endsAt <= nowMs) {
    return false;
  }

  return true;
}

function normalizePlacement(value: string | undefined): BannerPlacement {
  if (!value) {
    throw new ApiError(400, "VALIDATION_FAILED", "placement is required");
  }

  const normalized = value.trim().toLowerCase();

  if (!BANNER_PLACEMENTS.includes(normalized as BannerPlacement)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `placement must be one of: ${BANNER_PLACEMENTS.join(", ")}`,
    );
  }

  return normalized as BannerPlacement;
}

function normalizeLimit(value: string | undefined): number {
  if (!value) {
    return 5;
  }

  const limit = Number.parseInt(value, 10);

  if (!Number.isFinite(limit) || limit < 1 || limit > 20) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "limit must be an integer from 1 to 20",
    );
  }

  return limit;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}
