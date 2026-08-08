import type { ReactNode } from "react";

import { ReferralPanel } from "../../domains/referral/index.ts";
import { TasksView } from "../../domains/tasks/index.ts";
import { WheelPanel } from "../../domains/wheel/index.ts";
import "../../shared/styles/tasks-page.css";

export function TasksPage(): ReactNode {
  return (
    <main className="page tasks-page">
      <section
        id="task-referral"
        className="task-section referral-section"
        tabIndex={-1}
        aria-label="邀请好友"
      >
        <ReferralPanel />
      </section>
      <section className="task-section mission-section" aria-label="签到与任务">
        <TasksView afterCheckIn={<WheelPanel />} />
      </section>
    </main>
  );
}
