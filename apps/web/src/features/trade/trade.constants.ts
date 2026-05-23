import type {
  MarketItemTypeCode,
  MarketListingSort,
  MarketListingStatus,
  MarketMyListingSort,
  MarketPriceHealth,
  MarketRarityCode,
  MarketSellableItemSort,
  TradeTabId,
} from "./trade.types";

export const TRADE_TABS: ReadonlyArray<{
  id: TradeTabId;
  label: string;
}> = [
  { id: "buy", label: "购买" },
  { id: "sell", label: "出售" },
  { id: "manage", label: "报价 / 管理" },
];

export const MARKET_RARITY_LABELS: Readonly<Record<MarketRarityCode, string>> =
  {
    common: "普通",
    rare: "稀有",
    epic: "史诗",
    legendary: "传说",
    mythic: "神话",
  };

export const MARKET_ITEM_TYPE_LABELS: Readonly<
  Record<MarketItemTypeCode, string>
> = {
  character: "角色",
  pet: "宠物",
  egg: "蛋",
  decoration: "装饰",
  prop: "道具",
  material: "材料",
};

export const MARKET_PRICE_HEALTH_LABELS: Readonly<
  Record<MarketPriceHealth, string>
> = {
  too_low: "偏低",
  healthy: "合理",
  too_high: "偏高",
  unknown: "暂无参考",
};

export const MARKET_LISTING_STATUS_LABELS: Readonly<
  Record<MarketListingStatus, string>
> = {
  active: "出售中",
  partially_sold: "部分售出",
  sold: "已售罄",
  cancelled: "已下架",
  expired: "已过期",
  suspended: "已暂停",
};

export const MARKET_LISTING_SORT_OPTIONS: ReadonlyArray<{
  value: MarketListingSort;
  label: string;
}> = [
  { value: "recently_listed", label: "最新上架" },
  { value: "price_low_to_high", label: "价格从低到高" },
  { value: "price_high_to_low", label: "价格从高到低" },
  { value: "rarity_high_to_low", label: "稀有度优先" },
];

export const MARKET_SELLABLE_ITEM_SORT_OPTIONS: ReadonlyArray<{
  value: MarketSellableItemSort;
  label: string;
}> = [
  { value: "recently_obtained", label: "最新获得" },
  { value: "rarity_high_to_low", label: "稀有度从高到低" },
  { value: "rarity_low_to_high", label: "稀有度从低到高" },
  { value: "level_high_to_low", label: "等级从高到低" },
  { value: "level_low_to_high", label: "等级从低到高" },
  { value: "power_high_to_low", label: "战力从高到低" },
  { value: "power_low_to_high", label: "战力从低到高" },
  { value: "name_a_to_z", label: "名称 A-Z" },
];

export const MARKET_MY_LISTING_SORT_OPTIONS: ReadonlyArray<{
  value: MarketMyListingSort;
  label: string;
}> = [
  { value: "recently_listed", label: "最新上架" },
  { value: "price_low_to_high", label: "价格从低到高" },
  { value: "price_high_to_low", label: "价格从高到低" },
  { value: "value_high_to_low", label: "总价值从高到低" },
  { value: "value_low_to_high", label: "总价值从低到高" },
];

export const MARKET_MAX_KCOIN_PRICE = 1_000_000_000;
