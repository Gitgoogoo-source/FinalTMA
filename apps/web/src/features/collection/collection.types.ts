export type CollectionRarity = {
  code: string;
  label: string;
  sortOrder: number | null;
};

export type CollectionSeries = {
  id: string | null;
  slug: string | null;
  displayName: string | null;
};

export type CollectionForm = {
  id: string | null;
  index: number | null;
  displayName: string | null;
};

export type CollectionInventoryItem = {
  itemInstanceId: string;
  templateId: string | null;
  templateSlug: string | null;
  name: string;
  subtitle: string | null;
  description: string | null;
  rarity: CollectionRarity;
  series: CollectionSeries | null;
  form: CollectionForm | null;
  typeCode: string | null;
  serialNo: number | null;
  level: number;
  power: number;
  status: string | null;
  nftMintStatus: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  avatarUrl: string | null;
  isTradeable: boolean;
  isUpgradeable: boolean;
  isEvolvable: boolean;
  isDecomposable: boolean;
  isMintable: boolean;
  sourceType: string | null;
  sourceId: string | null;
  obtainedAt: string | null;
};

export type CollectionInventoryResponse = {
  items: CollectionInventoryItem[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
  statuses: string[];
  serverTime: string | null;
};
