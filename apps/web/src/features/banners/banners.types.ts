export type BannerPlacement =
  | "market_top"
  | "task_top"
  | "box_top"
  | "home_top"
  | "album_top";

export type BannerTargetType =
  | "box"
  | "listing"
  | "task"
  | "payment"
  | "external"
  | "none";

export type ActivityBannerItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  placement: BannerPlacement;
  targetType: BannerTargetType;
  targetRef: string | null;
  targetPayload: Record<string, unknown>;
  targetHref: string | null;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
};

export type BannersResponse = {
  items: ActivityBannerItem[];
  placement: BannerPlacement;
  serverTime: string | null;
};
