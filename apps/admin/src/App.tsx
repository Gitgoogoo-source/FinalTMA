import {
  Activity,
  Flag,
  KeyRound,
  RefreshCw,
  ReceiptText,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AdminMeResponse,
  AdminPermissionMode,
  AdminTab,
} from "./admin.types";
import { useAdminMe, type AdminMeStatus } from "./auth/useAdminMe";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DangerOpsPage } from "./pages/DangerOpsPage";
import { FeatureFlagsPage } from "./pages/FeatureFlagsPage";
import { MintQueuePage } from "./pages/MintQueuePage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { PermissionMatrixPage } from "./pages/PermissionMatrixPage";
import { RolesPage } from "./pages/RolesPage";
import { WalletsPage } from "./pages/WalletsPage";

type AdminNavItem = {
  id: AdminTab;
  label: string;
  icon: typeof ReceiptText;
  requiredPermissions: string[];
  permissionMode?: AdminPermissionMode;
};

const NAV_ITEMS: AdminNavItem[] = [
  {
    id: "monitoring",
    label: "监控",
    icon: Activity,
    requiredPermissions: ["payments:read", "mint:read", "onchain:read"],
  },
  {
    id: "payments",
    label: "支付",
    icon: ReceiptText,
    requiredPermissions: ["payments:read"],
  },
  {
    id: "mint",
    label: "Mint",
    icon: Activity,
    requiredPermissions: ["mint:read", "onchain:read"],
  },
  {
    id: "wallets",
    label: "钱包",
    icon: WalletCards,
    requiredPermissions: ["wallets:read", "wallet:read", "onchain:read"],
  },
  {
    id: "flags",
    label: "开关",
    icon: Flag,
    requiredPermissions: ["feature_flags:read", "admin:read"],
    permissionMode: "any",
  },
  {
    id: "danger",
    label: "危险操作",
    icon: ShieldAlert,
    requiredPermissions: [
      "payments:write",
      "feature_flags:write",
      "gacha:write",
      "risk:write",
      "users:ban",
      "inventory:write",
    ],
    permissionMode: "any",
  },
  {
    id: "audit",
    label: "审计",
    icon: ScrollText,
    requiredPermissions: ["audit:read", "admin:read"],
    permissionMode: "any",
  },
  {
    id: "admins",
    label: "管理员",
    icon: Users,
    requiredPermissions: ["admin:read"],
  },
  {
    id: "roles",
    label: "角色",
    icon: ShieldCheck,
    requiredPermissions: ["roles:read"],
  },
  {
    id: "permissions",
    label: "权限",
    icon: KeyRound,
    requiredPermissions: ["permissions:read"],
  },
];

export function App() {
  const initialHashTab = useMemo(() => readHashTab(), []);
  const [activeTab, setActiveTab] = useState<AdminTab>(
    initialHashTab ?? "monitoring",
  );
  const [hasExplicitTabRequest, setHasExplicitTabRequest] = useState(
    initialHashTab !== null,
  );
  const adminSession = useAdminMe();
  const adminMe = adminSession.me;
  const visibleNavItems = useMemo(
    () =>
      adminMe
        ? NAV_ITEMS.filter((item) => canAccessNavItem(item, adminMe))
        : [],
    [adminMe],
  );
  const activeNavItem =
    NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];
  const canAccessActiveTab =
    adminMe && activeNavItem ? canAccessNavItem(activeNavItem, adminMe) : false;

  useEffect(() => {
    function handleHashChange() {
      const nextTab = readHashTab();

      if (nextTab) {
        setActiveTab(nextTab);
        setHasExplicitTabRequest(true);
      }
    }

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (
      adminSession.status !== "authenticated" ||
      hasExplicitTabRequest ||
      visibleNavItems.length === 0
    ) {
      return;
    }

    if (!canAccessActiveTab) {
      const firstVisibleTab = visibleNavItems[0]?.id;

      if (firstVisibleTab) {
        setActiveTab(firstVisibleTab);
      }
    }
  }, [
    adminSession.status,
    canAccessActiveTab,
    hasExplicitTabRequest,
    visibleNavItems,
  ]);

  if (adminSession.status !== "authenticated" || !adminMe) {
    return (
      <AdminGateState
        error={adminSession.error}
        onRetry={() => void adminSession.refresh()}
        status={adminSession.status}
      />
    );
  }

  function selectTab(tab: AdminTab) {
    setActiveTab(tab);
    setHasExplicitTabRequest(false);

    if (window.location.hash !== `#${tab}`) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }

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
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeTab === item.id ? "is-active" : ""}
                key={item.id}
                onClick={() => selectTab(item.id)}
                title={item.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
          {visibleNavItems.length === 0 ? (
            <p className="admin-nav__empty">当前角色没有可访问页面</p>
          ) : null}
        </nav>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p>Phase 6 Admin</p>
            <h1>{activeNavItem?.label ?? "Admin"}</h1>
          </div>
          <AdminSessionSummary me={adminMe} refresh={adminSession.refresh} />
        </header>
        {canAccessActiveTab && activeNavItem ? (
          renderActivePage(activeTab, adminMe)
        ) : (
          <ForbiddenTabState item={activeNavItem} />
        )}
      </main>
    </div>
  );
}

function renderActivePage(tab: AdminTab, me: AdminMeResponse) {
  switch (tab) {
    case "monitoring":
      return <DashboardPage />;
    case "payments":
      return <PaymentsPage />;
    case "mint":
      return <MintQueuePage />;
    case "wallets":
      return <WalletsPage />;
    case "flags":
      return <FeatureFlagsPage />;
    case "danger":
      return <DangerOpsPage />;
    case "audit":
      return (
        <AuditLogsPage
          canExport={
            me.isSuperAdmin ||
            hasAdminPermission(me.permissions, "audit:export")
          }
        />
      );
    case "admins":
      return <AdminUsersPage />;
    case "roles":
      return <RolesPage />;
    case "permissions":
      return <PermissionMatrixPage />;
  }
}

function AdminGateState(props: {
  error: { code: string; message: string; requestId: string | null } | null;
  onRetry: () => void;
  status: AdminMeStatus;
}) {
  const copy = getAdminGateCopy(props.status);

  return (
    <main className="admin-gate">
      <section className="admin-gate__panel">
        <span className="admin-state-icon">
          <ShieldAlert aria-hidden="true" size={24} />
        </span>
        <div>
          <p>{copy.kicker}</p>
          <h1>{copy.title}</h1>
          <span>{copy.description}</span>
        </div>
        {props.error ? (
          <p className="notice notice--error">
            {props.error.message}
            {props.error.requestId
              ? ` requestId: ${props.error.requestId}`
              : ""}
          </p>
        ) : null}
        <div className="admin-state-actions">
          <button className="icon-button" onClick={props.onRetry} type="button">
            <RefreshCw aria-hidden="true" size={17} />
            <span>重新检查</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function ForbiddenTabState({ item }: { item: AdminNavItem | undefined }) {
  return (
    <section className="detail-panel admin-state-panel">
      <span className="admin-state-icon admin-state-icon--inline">
        <ShieldAlert aria-hidden="true" size={22} />
      </span>
      <div>
        <h2>403 无权访问</h2>
        <p>
          当前管理员角色没有访问 {item?.label ?? "该页面"} 的权限。后台权限以
          服务端 `requireAdmin` 返回为准，前端只负责隐藏不可访问入口。
        </p>
      </div>
      {item ? (
        <div className="permission-list">
          {item.requiredPermissions.map((permission) => (
            <span key={permission}>{permission}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AdminSessionSummary(props: {
  me: AdminMeResponse;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="admin-session">
      <span>
        <strong>{props.me.roleCode ?? "ADMIN"}</strong>
        <small>
          {props.me.isSuperAdmin
            ? "SUPER_ADMIN"
            : `${props.me.permissions.length} permissions`}
        </small>
      </span>
      <button
        className="icon-button"
        onClick={() => void props.refresh()}
        title="重新校验登录态"
        type="button"
      >
        <RefreshCw aria-hidden="true" size={16} />
        <span>校验</span>
      </button>
    </div>
  );
}

function getAdminGateCopy(status: AdminMeStatus): {
  kicker: string;
  title: string;
  description: string;
} {
  if (status === "loading") {
    return {
      kicker: "Admin session",
      title: "正在校验后台登录态",
      description: "后台会通过服务端 session 和 requireAdmin 校验管理员身份。",
    };
  }

  if (status === "session_expired") {
    return {
      kicker: "Session expired",
      title: "登录态已过期",
      description: "请退出后重新进入 Telegram Mini App，再回到后台重新校验。",
    };
  }

  if (status === "forbidden") {
    return {
      kicker: "Forbidden",
      title: "当前账号没有后台权限",
      description:
        "管理员身份只由服务端 ops.admin_users 和角色权限决定，前端不会伪造权限。",
    };
  }

  return {
    kicker: "Network error",
    title: "后台连接失败",
    description: "请检查网络或重新进入 Telegram Mini App 后再试。",
  };
}

function canAccessNavItem(item: AdminNavItem, me: AdminMeResponse): boolean {
  if (me.isSuperAdmin) {
    return true;
  }

  if (item.requiredPermissions.length === 0) {
    return true;
  }

  const checks = item.requiredPermissions.map((permission) =>
    hasAdminPermission(me.permissions, permission),
  );

  return item.permissionMode === "any"
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

function hasAdminPermission(
  ownedPermissions: string[],
  requiredPermission: string,
): boolean {
  const required = requiredPermission.trim().toLowerCase();

  return ownedPermissions.some((permission) => {
    const owned = permission.trim().toLowerCase();

    return (
      owned === "*" ||
      owned === required ||
      (owned.endsWith(":*") && required.startsWith(owned.slice(0, -1)))
    );
  });
}

function readHashTab(): AdminTab | null {
  const hash = window.location.hash.replace(/^#/, "");

  return isAdminTab(hash) ? hash : null;
}

function isAdminTab(value: string): value is AdminTab {
  return NAV_ITEMS.some((item) => item.id === value);
}
