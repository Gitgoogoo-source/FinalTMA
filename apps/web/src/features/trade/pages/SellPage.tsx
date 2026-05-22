import { BadgeDollarSign } from "lucide-react";

export function SellPage() {
  return (
    <section
      aria-labelledby="trade-tab-sell"
      className="trade-panel"
      data-testid="trade-sell-panel"
      id="trade-tab-panel-sell"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="trade-panel__empty">
        <BadgeDollarSign aria-hidden="true" size={34} strokeWidth={2.1} />
        <strong>暂无可出售藏品</strong>
        <span>可出售库存会显示在这里。</span>
      </div>
    </section>
  );
}
