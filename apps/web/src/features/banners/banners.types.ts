export type BannerPlacement =
  | "market_top"
  | "task_top"
  | "box_top"
  | "home_top"
  | "album_top";

export type ActivityBannerItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  placement: BannerPlacement;
  targetType: string;
  targetRef: string | null;
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
