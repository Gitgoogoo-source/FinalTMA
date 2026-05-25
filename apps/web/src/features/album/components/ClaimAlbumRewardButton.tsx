import { CheckCircle2, Clock, Gift, LockKeyhole } from "lucide-react";

import type { AlbumMilestoneStatus } from "../album.types";

type ClaimAlbumRewardButtonProps = {
  status: AlbumMilestoneStatus;
  isPending?: boolean;
  onClaim: () => void;
};

export function ClaimAlbumRewardButton({
  status,
  isPending = false,
  onClaim,
}: ClaimAlbumRewardButtonProps) {
  const button = getButtonState(status, isPending);
  const Icon = button.icon;

  return (
    <button
      className="album-claim-button"
      data-status={status}
      disabled={button.disabled}
      onClick={onClaim}
      type="button"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2.4} />
      {button.label}
    </button>
  );
}

function getButtonState(status: AlbumMilestoneStatus, isPending: boolean) {
  if (isPending) {
    return {
      disabled: true,
      icon: Clock,
      label: "领取中",
    };
  }

  if (status === "claimable") {
    return {
      disabled: false,
      icon: Gift,
      label: "领取",
    };
  }

  if (status === "claimed") {
    return {
      disabled: true,
      icon: CheckCircle2,
      label: "已领取",
    };
  }

  if (status === "expired") {
    return {
      disabled: true,
      icon: Clock,
      label: "已过期",
    };
  }

  return {
    disabled: true,
    icon: LockKeyhole,
    label: "未解锁",
  };
}
