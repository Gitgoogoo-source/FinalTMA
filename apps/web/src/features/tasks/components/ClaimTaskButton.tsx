import { CheckCircle2, Clock, Gift, LockKeyhole, Play } from "lucide-react";
import { Link } from "react-router-dom";

import type { TaskItem } from "../tasks.types";

type ClaimTaskButtonProps = {
  task: TaskItem;
  isPending?: boolean;
  onClaim: (task: TaskItem) => void;
};

export function ClaimTaskButton({
  isPending = false,
  onClaim,
  task,
}: ClaimTaskButtonProps) {
  if (task.status === "claimable") {
    return (
      <button
        className="claim-task-button"
        disabled={isPending}
        onClick={() => onClaim(task)}
        type="button"
      >
        {isPending ? (
          <Clock aria-hidden="true" size={15} strokeWidth={2.5} />
        ) : (
          <Gift aria-hidden="true" size={15} strokeWidth={2.5} />
        )}
        {isPending ? "领取中" : "领取"}
      </button>
    );
  }

  if (task.status === "claimed") {
    return (
      <button className="claim-task-button" disabled type="button">
        <CheckCircle2 aria-hidden="true" size={15} strokeWidth={2.5} />
        已领取
      </button>
    );
  }

  if (task.status === "expired" || task.status === "disabled") {
    return (
      <button className="claim-task-button" disabled type="button">
        <LockKeyhole aria-hidden="true" size={15} strokeWidth={2.5} />
        不可领取
      </button>
    );
  }

  if (task.actionRoute) {
    return (
      <Link
        className="claim-task-button claim-task-button--link"
        to={task.actionRoute}
      >
        <Play aria-hidden="true" size={15} strokeWidth={2.5} />
        去完成
      </Link>
    );
  }

  return (
    <button className="claim-task-button" disabled type="button">
      <Clock aria-hidden="true" size={15} strokeWidth={2.5} />
      进行中
    </button>
  );
}
