import { ClipboardList } from "lucide-react";

export function ManageListingsPage() {
  return (
    <section
      aria-labelledby="trade-tab-manage"
      className="trade-panel"
      data-testid="trade-manage-panel"
      id="trade-tab-panel-manage"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="trade-panel__empty">
        <ClipboardList aria-hidden="true" size={34} strokeWidth={2.1} />
        <strong>暂无报价</strong>
        <span>出售中的报价会显示在这里。</span>
      </div>
    </section>
  );
}
