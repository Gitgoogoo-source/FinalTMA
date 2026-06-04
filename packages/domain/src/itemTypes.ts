/**
 * 藏品类型枚举与展示常量。
 *
 * 注意：
 * 1. 这里是默认展示能力，不代表最终业务权限。
 * 2. 某个具体藏品是否可交易、可升级、可进化、可分解、可 Mint，必须以数据库 catalog.collectible_templates 配置为准。
 */

export const ITEM_TYPE = {
  CHARACTER: "CHARACTER",
  PET: "PET",
  EGG: "EGG",
  DECORATION: "DECORATION",
  PROP: "PROP",
} as const;

export type ItemTypeCode = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];

export type ItemTypeCategory = "collectible" | "box" | "cosmetic" | "utility";

export interface ItemTypeMeta {
  code: ItemTypeCode;
  displayNameCn: string;
  displayNameEn: string;
  shortLabel: string;
  iconKey: string;
  category: ItemTypeCategory;
  sortOrder: number;

  /**
   * 是否通常会进入图鉴展示。
   */
  defaultAppearsInAlbum: boolean;

  /**
   * 是否通常可被用户拥有为库存实例。
   */
  defaultCanBeOwned: boolean;

  /**
   * 是否默认可交易。
   * 最终以数据库配置为准。
   */
  defaultCanBeTraded: boolean;

  /**
   * 是否默认可升级。
   * 最终以数据库配置为准。
   */
  defaultCanBeUpgraded: boolean;

  /**
   * 是否默认可进化。
   * 最终以数据库配置为准。
   */
  defaultCanBeEvolved: boolean;

  /**
   * 是否默认可分解。
   * 最终以数据库配置为准。
   */
  defaultCanBeDecomposed: boolean;

  /**
   * 是否默认可 Mint 为链上 NFT。
   * 最终以数据库配置为准。
   */
  defaultCanBeMinted: boolean;

  description: string;
}

export const ITEM_TYPE_META = {
  [ITEM_TYPE.CHARACTER]: {
    code: ITEM_TYPE.CHARACTER,
    displayNameCn: "角色",
    displayNameEn: "Character",
    shortLabel: "角色",
    iconKey: "item-type-character",
    category: "collectible",
    sortOrder: 10,
    defaultAppearsInAlbum: true,
    defaultCanBeOwned: true,
    defaultCanBeTraded: true,
    defaultCanBeUpgraded: true,
    defaultCanBeEvolved: true,
    defaultCanBeDecomposed: true,
    defaultCanBeMinted: true,
    description:
      "主要收藏对象，支持展示、升级、进化、市场交易、图鉴收集和链上 Mint。",
  },

  [ITEM_TYPE.PET]: {
    code: ITEM_TYPE.PET,
    displayNameCn: "宠物",
    displayNameEn: "Pet",
    shortLabel: "宠物",
    iconKey: "item-type-pet",
    category: "collectible",
    sortOrder: 20,
    defaultAppearsInAlbum: true,
    defaultCanBeOwned: true,
    defaultCanBeTraded: true,
    defaultCanBeUpgraded: true,
    defaultCanBeEvolved: true,
    defaultCanBeDecomposed: true,
    defaultCanBeMinted: true,
    description:
      "可收藏的宠物类型藏品，可用于图鉴、市场交易、升级和链上 Mint。",
  },

  [ITEM_TYPE.EGG]: {
    code: ITEM_TYPE.EGG,
    displayNameCn: "蛋",
    displayNameEn: "Egg",
    shortLabel: "蛋",
    iconKey: "item-type-egg",
    category: "box",
    sortOrder: 30,
    defaultAppearsInAlbum: false,
    defaultCanBeOwned: false,
    defaultCanBeTraded: false,
    defaultCanBeUpgraded: false,
    defaultCanBeEvolved: false,
    defaultCanBeDecomposed: false,
    defaultCanBeMinted: false,
    description:
      "盲盒或开盒入口类型，通常用于支付开盒展示，不作为普通藏品实例进入库存。",
  },

  [ITEM_TYPE.DECORATION]: {
    code: ITEM_TYPE.DECORATION,
    displayNameCn: "装饰",
    displayNameEn: "Decoration",
    shortLabel: "装饰",
    iconKey: "item-type-decoration",
    category: "cosmetic",
    sortOrder: 40,
    defaultAppearsInAlbum: true,
    defaultCanBeOwned: true,
    defaultCanBeTraded: true,
    defaultCanBeUpgraded: false,
    defaultCanBeEvolved: false,
    defaultCanBeDecomposed: true,
    defaultCanBeMinted: true,
    description:
      "装饰类藏品，可用于图鉴、展示、市场交易或链上 Mint，通常不参与战力升级。",
  },

  [ITEM_TYPE.PROP]: {
    code: ITEM_TYPE.PROP,
    displayNameCn: "道具",
    displayNameEn: "Prop",
    shortLabel: "道具",
    iconKey: "item-type-prop",
    category: "utility",
    sortOrder: 50,
    defaultAppearsInAlbum: false,
    defaultCanBeOwned: true,
    defaultCanBeTraded: false,
    defaultCanBeUpgraded: false,
    defaultCanBeEvolved: false,
    defaultCanBeDecomposed: false,
    defaultCanBeMinted: false,
    description:
      "功能型道具，通常用于活动、任务、消耗或特殊玩法，不默认进入交易市场。",
  },
} as const satisfies Record<ItemTypeCode, ItemTypeMeta>;

export const ITEM_TYPE_CODES = Object.values(ITEM_TYPE) as ItemTypeCode[];

export const ITEM_TYPE_CODES_BY_ASC = [...ITEM_TYPE_CODES].sort(
  (a, b) => ITEM_TYPE_META[a].sortOrder - ITEM_TYPE_META[b].sortOrder,
);

export function isItemTypeCode(value: unknown): value is ItemTypeCode {
  return (
    typeof value === "string" &&
    (ITEM_TYPE_CODES as readonly string[]).includes(value)
  );
}

export function assertItemTypeCode(
  value: unknown,
): asserts value is ItemTypeCode {
  if (!isItemTypeCode(value)) {
    throw new Error(`Invalid item type code: ${String(value)}`);
  }
}

export function getItemTypeMeta(code: ItemTypeCode): ItemTypeMeta {
  return ITEM_TYPE_META[code];
}

export function getItemTypeDisplayName(
  code: ItemTypeCode,
  locale: "zh-CN" | "en-US" = "zh-CN",
): string {
  const meta = getItemTypeMeta(code);
  return locale === "en-US" ? meta.displayNameEn : meta.displayNameCn;
}
