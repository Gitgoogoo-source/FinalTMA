import { Link } from "react-router-dom";

import { APP_ROUTES } from "@/shared/constants/routes";

export function TasksPage() {
  return (
    <section className="placeholder-page" data-testid="tasks-page">
      <strong>任务功能后续开放</strong>
      <Link to={APP_ROUTES.box}>返回开盒</Link>
    </section>
  );
}
