import {
  CheckCircle2,
  LockKeyhole,
  PackageCheck,
  ShoppingBag,
} from "lucide-react";

type ItemStatusBadgeProps = {
  status: string | null;
  isListed?: boolean;
  lockReason?: string | null;
};

export function ItemStatusBadge({
  isListed = false,
  lockReason,
  status,
}: ItemStatusBadgeProps) {
  const meta = getItemStatusMeta(status, isListed, lockReason);
  const Icon = meta.icon;

  return (
    <span className={`item-status-badge item-status-badge--${meta.tone}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

export function getCollectionStatusLabel(
  status: string | null | undefined,
  isListed = false,
): string {
  if (isListed || status === "listed") {
    return "挂售中";
  }

  switch (status) {
    case "available":
      return "可使用";
    case "locked":
      return "锁定中";
    case "minting":
      return "Mint 中";
    case "minted":
      return "已 Mint";
    case "consumed":
      return "已消耗";
    case "decomposed":
      return "已分解";
    case "transferred":
      return "已转出";
    case "burned":
      return "已销毁";
    default:
      return status ?? "未知状态";
  }
}

export function getCollectionLockReasonLabel(
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "market_listing":
      return "市场挂单";
    case "market_order":
      return "市场订单";
    case "evolution":
      return "合成处理中";
    case "decompose":
      return "分解处理中";
    case "upgrade":
      return "升级处理中";
    case "mint":
      return "Mint 处理中";
    case "admin":
      return "管理员锁定";
    default:
      return reason ?? "状态限制";
  }
}

function getItemStatusMeta(
  status: string | null,
  isListed: boolean,
  lockReason: string | null | undefined,
) {
  if (isListed || status === "listed") {
    return {
      icon: ShoppingBag,
      label: "挂售中",
      tone: "listed",
    } as const;
  }

  if (status === "available") {
    return {
      icon: CheckCircle2,
      label: "可使用",
      tone: "available",
    } as const;
  }

  if (status === "locked" || status === "minting" || lockReason) {
    return {
      icon: LockKeyhole,
      label: getCollectionStatusLabel(status),
      tone: "blocked",
    } as const;
  }

  return {
    icon: PackageCheck,
    label: getCollectionStatusLabel(status),
    tone: "neutral",
  } as const;
}
