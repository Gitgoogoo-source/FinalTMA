import type { TaskCategoryFilter } from "../tasks.types";

type TaskCategoryTabsProps = {
  activeCategory: TaskCategoryFilter;
  onChange: (category: TaskCategoryFilter) => void;
};

const TASK_CATEGORY_TABS: Array<{
  id: TaskCategoryFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "daily", label: "每日" },
  { id: "social", label: "社交" },
  { id: "trade", label: "交易" },
  { id: "onchain", label: "链上" },
];

export function TaskCategoryTabs({
  activeCategory,
  onChange,
}: TaskCategoryTabsProps) {
  return (
    <div className="task-category-tabs" role="tablist" aria-label="任务分类">
      {TASK_CATEGORY_TABS.map((tab) => (
        <button
          aria-selected={activeCategory === tab.id}
          data-active={activeCategory === tab.id}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
