import { Activity, Flag, ReceiptText, WalletCards } from "lucide-react";
import { useState } from "react";

import type { AdminTab } from "./admin.types";
import { FeatureFlagsPage } from "./pages/FeatureFlagsPage";
import { MintQueuePage } from "./pages/MintQueuePage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { WalletsPage } from "./pages/WalletsPage";

const NAV_ITEMS: Array<{
  id: AdminTab;
  label: string;
  icon: typeof ReceiptText;
}> = [
  { id: "payments", label: "支付", icon: ReceiptText },
  { id: "mint", label: "Mint", icon: Activity },
  { id: "wallets", label: "钱包", icon: WalletCards },
  { id: "flags", label: "开关", icon: Flag },
];

export function App() {
  const [activeTab, setActiveTab] = useState<AdminTab>("payments");

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <span className="admin-brand__mark">TMA</span>
          <span>
            <strong>Ops Console</strong>
            <small>Payment and onchain</small>
          </span>
        </div>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeTab === item.id ? "is-active" : ""}
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p>Phase 5 Admin</p>
            <h1>{NAV_ITEMS.find((item) => item.id === activeTab)?.label}</h1>
          </div>
        </header>
        {activeTab === "payments" ? <PaymentsPage /> : null}
        {activeTab === "mint" ? <MintQueuePage /> : null}
        {activeTab === "wallets" ? <WalletsPage /> : null}
        {activeTab === "flags" ? <FeatureFlagsPage /> : null}
      </main>
    </div>
  );
}
