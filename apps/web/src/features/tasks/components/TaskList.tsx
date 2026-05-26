import { RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";

import type { TaskItem } from "../tasks.types";
import { TaskRow } from "./TaskRow";

type TaskListProps = {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  pendingTaskId: string | null;
  tasks: TaskItem[];
  onClaim: (task: TaskItem) => void;
  onRetry: () => void;
};

export function TaskList({
  error,
  isError,
  isLoading,
  onClaim,
  onRetry,
  pendingTaskId,
  tasks,
}: TaskListProps) {
  if (isLoading) {
    return (
      <section className="task-list-state" aria-busy="true">
        <span className="task-list-state__spinner" />
        <strong>任务加载中</strong>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="task-list-state" role="alert">
        <strong>任务读取失败</strong>
        <span>{getApiErrorMessage(error)}</span>
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={15} strokeWidth={2.5} />
          重试
        </button>
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="task-list-state">
        <strong>暂无任务</strong>
        <span>当前分类没有可展示的任务。</span>
      </section>
    );
  }

  return (
    <section className="task-list" aria-label="任务列表">
      {tasks.map((task) => (
        <TaskRow
          isPending={pendingTaskId === task.taskId}
          key={`${task.taskId}:${task.periodKey ?? "none"}`}
          onClaim={onClaim}
          task={task}
        />
      ))}
    </section>
  );
}
