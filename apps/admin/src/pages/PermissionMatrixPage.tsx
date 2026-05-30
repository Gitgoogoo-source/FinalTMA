import { ClipboardCheck, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AdminPermissionDefinition,
  AdminPermissionMatrix,
} from "../admin.types";
import { formatDate, StatusBadge } from "../admin.ui";

const PERMISSION_DOMAINS: AdminPermissionMatrix["domains"] = [
  {
    domain: "payments",
    label: "支付",
    description: "Telegram Stars 订单、webhook、退款和发货重试。",
    permissions: [
      buildPermission("payments:read", "查看支付", "读取支付订单和异常。"),
      buildPermission("payments:write", "处理支付", "执行支付后台写操作。"),
      buildPermission("payments:retry", "重试发货", "触发支付发货重试。"),
    ],
  },
  {
    domain: "mint",
    label: "Mint",
    description: "NFT Mint 队列、失败重试和链上状态处理。",
    permissions: [
      buildPermission("mint:read", "查看队列", "读取 Mint 队列。"),
      buildPermission("mint:write", "处理队列", "执行 Mint 队列写操作。"),
    ],
  },
  {
    domain: "inventory",
    label: "库存",
    description: "库存锁定、释放和人工运营干预。",
    permissions: [
      buildPermission("inventory:read", "查看库存", "读取库存和锁定状态。"),
      buildPermission("inventory:write", "处理库存", "释放或调整库存锁定。"),
    ],
  },
  {
    domain: "onchain",
    label: "链上",
    description: "TON 钱包、链上同步和 NFT 状态。",
    permissions: [
      buildPermission("onchain:read", "查看链上", "读取链上同步状态。"),
      buildPermission("onchain:write", "处理链上", "执行链上状态写操作。"),
    ],
  },
  {
    domain: "feature_flags",
    label: "功能开关",
    description: "支付、市场、Mint 等运行时开关。",
    permissions: [
      buildPermission("feature_flags:read", "查看开关", "读取功能开关。"),
      buildPermission(
        "feature_flags:write",
        "修改开关",
        "暂停或启用功能开关。",
      ),
    ],
  },
  {
    domain: "audit",
    label: "审计",
    description: "后台操作日志和安全追踪。",
    permissions: [
      buildPermission("audit:read", "查看审计", "读取后台审计日志。"),
    ],
  },
  {
    domain: "risk",
    label: "风控",
    description: "异常行为、封禁、锁定和人工复核。",
    permissions: [
      buildPermission("risk:read", "查看风控", "读取风险事件。"),
      buildPermission("risk:write", "处理风控", "调整风控事件状态。"),
    ],
  },
  {
    domain: "gacha",
    label: "盲盒",
    description: "盲盒、概率池、活动状态和库存配置。",
    permissions: [
      buildPermission("gacha:read", "查看盲盒", "读取盲盒运营配置。"),
      buildPermission("gacha:write", "修改盲盒", "调整盲盒运营配置。"),
    ],
  },
  {
    domain: "market",
    label: "市场",
    description: "市场挂单、成交、手续费和运营干预。",
    permissions: [
      buildPermission("market:read", "查看市场", "读取市场运营数据。"),
      buildPermission("market:write", "处理市场", "执行市场后台写操作。"),
    ],
  },
  {
    domain: "users",
    label: "用户",
    description: "用户状态、客服排查和封禁入口。",
    permissions: [
      buildPermission("users:read", "查看用户", "读取用户客服信息。"),
      buildPermission("users:ban", "封禁用户", "限制异常用户写操作。"),
    ],
  },
  {
    domain: "reports",
    label: "报表",
    description: "商业运营 BI、收入、留存和活动表现。",
    permissions: [
      buildPermission("reports:read", "查看报表", "读取运营报表。"),
    ],
  },
];

export function PermissionMatrixPage() {
  const [data, setData] = useState<AdminPermissionMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const permissionCount = useMemo(() => {
    return (data?.domains ?? []).reduce(
      (count, domain) => count + domain.permissions.length,
      0,
    );
  }, [data]);

  function load() {
    setLoading(true);
    setError(null);

    try {
      setData({
        domains: PERMISSION_DOMAINS,
        serverTime: new Date().toISOString(),
      });
    } catch {
      setError("权限矩阵加载失败");
    } finally {
      setLoading(false);
    }
  }

  function prepareWriteAction(permission: AdminPermissionDefinition) {
    const reason = window.prompt(`请输入申请调整 ${permission.code} 的原因`);

    if (!reason?.trim()) {
      return;
    }

    if (!window.confirm(`确认提交 ${permission.code} 权限变更占位请求？`)) {
      return;
    }

    setNotice(
      `${permission.code} 权限变更已进入前端确认占位。第 5 步 API 接入前不会修改角色权限。`,
    );
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <button className="icon-button" onClick={load} type="button">
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
        <span className="toolbar__meta">
          {data ? `更新时间 ${formatDate(data.serverTime)}` : "等待加载"}
        </span>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        <span>
          <strong>{data?.domains.length ?? 0}</strong>
          <small>权限域</small>
        </span>
        <span>
          <strong>{permissionCount}</strong>
          <small>权限点</small>
        </span>
      </div>

      {!loading && !error && (data?.domains.length ?? 0) === 0 ? (
        <p className="notice">暂无权限矩阵</p>
      ) : null}

      <div className="permission-domain-grid">
        {(data?.domains ?? []).map((domain) => (
          <section className="ops-card permission-domain" key={domain.domain}>
            <div className="permission-domain__header">
              <div>
                <h2>{domain.label}</h2>
                <p>{domain.description}</p>
              </div>
              <StatusBadge status={domain.domain} />
            </div>
            <div className="stack-list">
              {domain.permissions.map((permission) => (
                <div className="permission-row" key={permission.code}>
                  <span>
                    <strong>{permission.code}</strong>
                    <small>
                      {permission.label} · {permission.description}
                    </small>
                  </span>
                  <span className="list-row__actions">
                    <StatusBadge status={permission.risk} />
                    <button
                      className="icon-button"
                      onClick={() => prepareWriteAction(permission)}
                      title="权限变更占位"
                      type="button"
                    >
                      <ClipboardCheck aria-hidden="true" size={16} />
                      <span>变更</span>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function buildPermission(
  code: string,
  label: string,
  description: string,
): AdminPermissionDefinition {
  return {
    code,
    label,
    description,
    risk:
      code.includes(":write") ||
      code.includes(":ban") ||
      code.includes(":retry")
        ? "danger"
        : "read",
  };
}
