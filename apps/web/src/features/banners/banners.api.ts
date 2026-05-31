import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  ActivityBannerItem,
  BannerPlacement,
  BannerTargetType,
  BannersResponse,
} from "./banners.types";

const BANNER_PLACEMENTS: readonly BannerPlacement[] = [
  "market_top",
  "task_top",
  "box_top",
  "home_top",
  "album_top",
];
const BANNER_TARGET_TYPES: readonly BannerTargetType[] = [
  "box",
  "listing",
  "task",
  "payment",
  "external",
  "none",
];

export async function fetchBanners(
  placement: BannerPlacement,
): Promise<BannersResponse> {
  const params = new URLSearchParams({
    placement,
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.banners.list}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeBannersResponse(response, placement);
}

function normalizeBannersResponse(
  response: unknown,
  requestedPlacement: BannerPlacement,
): BannersResponse {
  const payload = isRecord(response) ? response : {};
  const placement = normalizePlacement(
    readString(payload.placement),
    requestedPlacement,
  );
  const items = Array.isArray(payload.items)
    ? payload.items
        .map((item) => normalizeBanner(item, placement))
        .filter(isActivityBannerItem)
    : [];

  return {
    items,
    placement,
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizeBanner(
  value: unknown,
  fallbackPlacement: BannerPlacement,
): ActivityBannerItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const code = readString(value.code);
  const title = readString(value.title);

  if (!id || !code || !title) {
    return null;
  }

  const targetPayload = readRecord(value.targetPayload ?? value.target_payload);

  return {
    id,
    code,
    title,
    description: readString(value.description),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    placement: normalizePlacement(
      readString(value.placement),
      fallbackPlacement,
    ),
    targetType: normalizeTargetType(
      readString(value.targetType) ?? readString(value.target_type),
    ),
    targetRef: readString(value.targetRef) ?? readString(value.target_ref),
    targetPayload,
    targetHref: readString(value.targetHref) ?? readString(value.target_href),
    sortOrder:
      readNumber(value.sortOrder) ?? readNumber(value.sort_order) ?? 100,
    startsAt: readString(value.startsAt) ?? readString(value.starts_at),
    endsAt: readString(value.endsAt) ?? readString(value.ends_at),
  };
}

function normalizeTargetType(value: string | null): BannerTargetType {
  if (!value) {
    return "none";
  }

  if (BANNER_TARGET_TYPES.includes(value as BannerTargetType)) {
    return value as BannerTargetType;
  }

  switch (value) {
    case "market_listing":
      return "listing";
    case "external_url":
      return "external";
    default:
      return "none";
  }
}

function normalizePlacement(
  value: string | null,
  fallback: BannerPlacement,
): BannerPlacement {
  return value && BANNER_PLACEMENTS.includes(value as BannerPlacement)
    ? (value as BannerPlacement)
    : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActivityBannerItem(
  value: ActivityBannerItem | null,
): value is ActivityBannerItem {
  return value !== null;
}
