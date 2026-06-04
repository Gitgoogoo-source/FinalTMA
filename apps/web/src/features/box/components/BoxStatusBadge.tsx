import type { BoxStatus } from "../box.types";

type BoxStatusBadgeProps = {
  status: BoxStatus;
  disabledReason?: string | null;
};

const STATUS_META: Record<
  BoxStatus,
  {
    label: string;
    tone: "success" | "warning" | "disabled";
  }
> = {
  draft: {
    label: "草稿",
    tone: "disabled",
  },
  active: {
    label: "进行中",
    tone: "success",
  },
  not_started: {
    label: "未开始",
    tone: "disabled",
  },
  paused: {
    label: "已暂停",
    tone: "warning",
  },
  ended: {
    label: "已结束",
    tone: "disabled",
  },
  sold_out: {
    label: "不可开启",
    tone: "disabled",
  },
  archived: {
    label: "已归档",
    tone: "disabled",
  },
};

export function BoxStatusBadge({
  status,
  disabledReason,
}: BoxStatusBadgeProps) {
  const meta = STATUS_META[status];
  const label = disabledReason
    ? `${meta.label} · ${disabledReason}`
    : meta.label;

  return (
    <span className={`box-status-badge box-status-badge--${meta.tone}`}>
      {label}
    </span>
  );
}
