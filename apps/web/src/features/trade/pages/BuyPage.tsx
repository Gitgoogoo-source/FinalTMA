import { ShoppingBag } from "lucide-react";

export function BuyPage() {
  return (
    <section
      aria-labelledby="trade-tab-buy"
      className="trade-panel"
      data-testid="trade-buy-panel"
      id="trade-tab-panel-buy"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="trade-panel__empty">
        <ShoppingBag aria-hidden="true" size={34} strokeWidth={2.1} />
        <strong>暂无挂单</strong>
        <span>当前市场没有可购买藏品。</span>
      </div>
    </section>
  );
}
