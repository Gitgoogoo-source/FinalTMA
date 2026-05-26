import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchTaskOverview } from "../tasks.api";
import type { TaskItem, TaskListQuery } from "../tasks.types";

export function useTasks(query: TaskListQuery = {}) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.tasks.overview(userId),
    queryFn: fetchTaskOverview,
    enabled: session.isAuthenticated,
  });
  const tasks = useMemo(
    () => filterTasks(result.data?.tasks ?? [], query),
    [query, result.data?.tasks],
  );

  return {
    ...result,
    overview: result.data ?? null,
    allTasks: result.data?.tasks ?? [],
    tasks,
  };
}

function filterTasks(tasks: TaskItem[], query: TaskListQuery): TaskItem[] {
  return tasks.filter((task) => {
    if (!query.includeClaimed && task.status === "claimed") {
      return false;
    }

    if (!query.category || query.category === "all") {
      return true;
    }

    if (query.category === "social") {
      return task.category === "social" || task.category === "referral";
    }

    if (query.category === "onchain") {
      return task.category === "onchain" || task.category === "wallet";
    }

    return task.category === query.category;
  });
}
