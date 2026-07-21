import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ReferralPanel } from "../../domains/referral/index.ts";
import { TasksView } from "../../domains/tasks/index.ts";
import { focusTaskTarget } from "../../shared/navigation/focusTaskTarget.ts";

export function TasksPage(): ReactNode {
  const navigate = useNavigate();
  return (
    <main className="page tasks-page">
      <header className="tasks-screen-heading">
        <button aria-label="返回上一页" onClick={() => navigate(-1)}>
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1>任务中心</h1>
        <button
          aria-label="查看任务分类"
          onClick={() =>
            focusTaskTarget(document.getElementById("task-filters"))
          }
        >
          <SlidersHorizontal aria-hidden="true" />
        </button>
      </header>
      <section
        id="task-referral"
        className="task-section referral-section"
        tabIndex={-1}
        aria-label="邀请好友"
      >
        <ReferralPanel />
      </section>
      <section className="task-section mission-section" aria-label="签到与任务">
        <TasksView />
      </section>
    </main>
  );
}
