import { ListChecks, Users } from "lucide-react";
import type { ReactNode } from "react";

import { ReferralPanel } from "../../domains/referral/index.ts";
import { TasksView } from "../../domains/tasks/index.ts";

export function TasksPage(): ReactNode {
  return (
    <main className="page tasks-page">
      <header className="page-heading tasks-heading">
        <div>
          <span>DAILY MISSIONS</span>
          <h1>任务中心</h1>
        </div>
        <ListChecks aria-hidden="true" />
      </header>
      <section className="task-section referral-section">
        <div className="section-heading">
          <span className="section-icon">
            <Users aria-hidden="true" />
          </span>
          <div>
            <small>GROW TOGETHER</small>
            <h2>邀请好友</h2>
          </div>
        </div>
        <ReferralPanel />
      </section>
      <section className="task-section mission-section">
        <div className="section-heading">
          <span className="section-icon">
            <ListChecks aria-hidden="true" />
          </span>
          <div>
            <small>TODAY</small>
            <h2>签到与任务</h2>
          </div>
        </div>
        <TasksView />
      </section>
    </main>
  );
}
