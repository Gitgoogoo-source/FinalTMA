import {
  Ban,
  Coins,
  FlagOff,
  Gift,
  LockOpen,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  runAdminDangerOperation,
  updateFeatureFlag,
  type AdminDangerAction,
} from "../admin.api";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

const PAYMENT_PAUSE_FLAGS = [
  "FEATURE_STARS_PAYMENT_ENABLED",
  "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
  "gacha.open_box",
];
const CURRENCIES = ["KCOIN", "FGEMS", "STAR_DISPLAY"];

type PendingDanger = {
  action: AdminDangerAction | "pause_payment";
  confirmLabel: string;
  targetLabel: string;
  targetValue: string;
  title: string;
  submit: (reason: string) => Promise<unknown>;
};

export function DangerOpsPage() {
  const [paymentFlag, setPaymentFlag] = useState(PAYMENT_PAUSE_FLAGS[0] ?? "");
  const [boxId, setBoxId] = useState("");
  const [dropPoolItems, setDropPoolItems] = useState("[]");
  const [compUserId, setCompUserId] = useState("");
  const [compCurrency, setCompCurrency] = useState(CURRENCIES[0] ?? "KCOIN");
  const [compAmount, setCompAmount] = useState("");
  const [banUserId, setBanUserId] = useState("");
  const [banStatus, setBanStatus] = useState("banned");
  const [refundOrderId, setRefundOrderId] = useState("");
  const [lockId, setLockId] = useState("");
  const [approvalAdminId, setApprovalAdminId] = useState("");
  const [pendingDanger, setPendingDanger] = useState<PendingDanger | null>(
    null,
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const approvalContext = useMemo(
    () => ({
      phase: "phase6_initial",
      approvalStatus: "not_required",
      secondApproverAdminId: approvalAdminId.trim() || null,
    }),
    [approvalAdminId],
  );

  async function submitPending(reason: string) {
    if (!pendingDanger) {
      return;
    }

    setBusyAction(pendingDanger.action);
    setError(null);
    setNotice(null);

    try {
      await pendingDanger.submit(reason);
      setNotice(`${pendingDanger.title} 已提交`);
      setPendingDanger(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "危险操作提交失败",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function openPausePayment() {
    const target = paymentFlag.trim();

    if (!target) {
      setError("请选择支付开关");
      return;
    }

    setPendingDanger({
      action: "pause_payment",
      confirmLabel: "确认暂停",
      targetLabel: "Feature flag",
      targetValue: target,
      title: "暂停支付",
      submit: (reason) =>
        updateFeatureFlag({
          key: target,
          enabled: false,
          reason,
        }),
    });
  }

  function openPublishDropPool() {
    const target = boxId.trim();

    if (!target) {
      setError("Box ID 不能为空");
      return;
    }

    let items: unknown;

    try {
      items = JSON.parse(dropPoolItems);
    } catch {
      setError("概率配置 JSON 无法解析");
      return;
    }

    if (!Array.isArray(items)) {
      setError("概率配置必须是数组");
      return;
    }

    setPendingDanger({
      action: "publish_drop_pool_version",
      confirmLabel: "确认发布",
      targetLabel: "Box ID",
      targetValue: target,
      title: "发布概率版本",
      submit: (reason) =>
        runAdminDangerOperation({
          action: "publish_drop_pool_version",
          targetId: target,
          reason,
          payload: {
            boxId: target,
            items,
          },
          approvalContext,
        }),
    });
  }

  function openCompensateAsset() {
    const target = compUserId.trim();

    if (!target || !compAmount.trim()) {
      setError("补偿用户和数量不能为空");
      return;
    }

    setPendingDanger({
      action: "compensate_asset",
      confirmLabel: "确认补偿",
      targetLabel: "User ID",
      targetValue: target,
      title: "补偿资产",
      submit: (reason) =>
        runAdminDangerOperation({
          action: "compensate_asset",
          targetId: target,
          reason,
          payload: {
            userId: target,
            currencyCode: compCurrency,
            amount: Number(compAmount),
          },
          approvalContext,
        }),
    });
  }

  function openBanUser() {
    const target = banUserId.trim();

    if (!target) {
      setError("封禁用户不能为空");
      return;
    }

    setPendingDanger({
      action: "ban_user",
      confirmLabel: "确认封禁",
      targetLabel: "User ID",
      targetValue: target,
      title: "封禁用户",
      submit: (reason) =>
        runAdminDangerOperation({
          action: "ban_user",
          targetId: target,
          reason,
          payload: {
            userId: target,
            status: banStatus,
          },
          approvalContext,
        }),
    });
  }

  function openRefund() {
    const target = refundOrderId.trim();

    if (!target) {
      setError("退款订单不能为空");
      return;
    }

    setPendingDanger({
      action: "request_refund",
      confirmLabel: "确认记录",
      targetLabel: "Order ID",
      targetValue: target,
      title: "记录退款请求",
      submit: (reason) =>
        runAdminDangerOperation({
          action: "request_refund",
          targetId: target,
          reason,
          payload: {
            starOrderId: target,
          },
          approvalContext,
        }),
    });
  }

  function openReleaseLock() {
    const target = lockId.trim();

    if (!target) {
      setError("库存锁不能为空");
      return;
    }

    setPendingDanger({
      action: "release_inventory_lock",
      confirmLabel: "确认释放",
      targetLabel: "Lock ID",
      targetValue: target,
      title: "释放锁定库存",
      submit: (reason) =>
        runAdminDangerOperation({
          action: "release_inventory_lock",
          targetId: target,
          reason,
          payload: {
            lockId: target,
          },
          approvalContext,
        }),
    });
  }

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>二人审批 Admin ID</span>
          <input
            onChange={(event) => setApprovalAdminId(event.target.value)}
            placeholder="optional"
            value={approvalAdminId}
          />
        </label>
        <button
          className="icon-button"
          onClick={() => {
            setError(null);
            setNotice(null);
          }}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>清空状态</span>
        </button>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="danger-action-grid">
        <section className="ops-card danger-action-card">
          <h2>暂停支付</h2>
          <label>
            <span>目标开关</span>
            <select
              onChange={(event) => setPaymentFlag(event.target.value)}
              value={paymentFlag}
            >
              {PAYMENT_PAUSE_FLAGS.map((flag) => (
                <option key={flag} value={flag}>
                  {flag}
                </option>
              ))}
            </select>
          </label>
          <DangerSubmitButton
            busy={busyAction === "pause_payment"}
            icon="flag"
            label="暂停"
            onClick={openPausePayment}
          />
        </section>

        <section className="ops-card danger-action-card danger-action-card--wide">
          <h2>修改概率</h2>
          <label>
            <span>Box ID</span>
            <input
              onChange={(event) => setBoxId(event.target.value)}
              value={boxId}
            />
          </label>
          <label>
            <span>Items JSON</span>
            <textarea
              onChange={(event) => setDropPoolItems(event.target.value)}
              rows={8}
              value={dropPoolItems}
            />
          </label>
          <DangerSubmitButton
            busy={busyAction === "publish_drop_pool_version"}
            icon="rotate"
            label="发布版本"
            onClick={openPublishDropPool}
          />
        </section>

        <section className="ops-card danger-action-card">
          <h2>补偿资产</h2>
          <label>
            <span>User ID</span>
            <input
              onChange={(event) => setCompUserId(event.target.value)}
              value={compUserId}
            />
          </label>
          <div className="form-inline">
            <label>
              <span>币种</span>
              <select
                onChange={(event) => setCompCurrency(event.target.value)}
                value={compCurrency}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>数量</span>
              <input
                inputMode="numeric"
                onChange={(event) => setCompAmount(event.target.value)}
                value={compAmount}
              />
            </label>
          </div>
          <DangerSubmitButton
            busy={busyAction === "compensate_asset"}
            icon="coins"
            label="补偿"
            onClick={openCompensateAsset}
          />
        </section>

        <section className="ops-card danger-action-card">
          <h2>封禁用户</h2>
          <label>
            <span>User ID</span>
            <input
              onChange={(event) => setBanUserId(event.target.value)}
              value={banUserId}
            />
          </label>
          <label>
            <span>状态</span>
            <select
              onChange={(event) => setBanStatus(event.target.value)}
              value={banStatus}
            >
              <option value="banned">banned</option>
              <option value="restricted">restricted</option>
            </select>
          </label>
          <DangerSubmitButton
            busy={busyAction === "ban_user"}
            icon="ban"
            label="封禁"
            onClick={openBanUser}
          />
        </section>

        <section className="ops-card danger-action-card">
          <h2>退款</h2>
          <label>
            <span>Star Order ID</span>
            <input
              onChange={(event) => setRefundOrderId(event.target.value)}
              value={refundOrderId}
            />
          </label>
          <DangerSubmitButton
            busy={busyAction === "request_refund"}
            icon="gift"
            label="记录退款"
            onClick={openRefund}
          />
        </section>

        <section className="ops-card danger-action-card">
          <h2>释放锁定库存</h2>
          <label>
            <span>Inventory Lock ID</span>
            <input
              onChange={(event) => setLockId(event.target.value)}
              value={lockId}
            />
          </label>
          <DangerSubmitButton
            busy={busyAction === "release_inventory_lock"}
            icon="unlock"
            label="释放"
            onClick={openReleaseLock}
          />
        </section>
      </div>

      <ConfirmDangerDialog
        confirmLabel={pendingDanger?.confirmLabel}
        isOpen={pendingDanger !== null}
        pending={pendingDanger ? busyAction === pendingDanger.action : false}
        targetLabel={pendingDanger?.targetLabel ?? ""}
        targetValue={pendingDanger?.targetValue ?? ""}
        title={pendingDanger?.title ?? "危险操作确认"}
        onCancel={() => setPendingDanger(null)}
        onConfirm={(confirmation) => submitPending(confirmation.reason)}
      />
    </section>
  );
}

function DangerSubmitButton(props: {
  busy: boolean;
  icon: "ban" | "coins" | "flag" | "gift" | "rotate" | "unlock";
  label: string;
  onClick: () => void;
}) {
  const Icon = getDangerIcon(props.icon);

  return (
    <button
      className="icon-button icon-button--danger"
      disabled={props.busy}
      onClick={props.onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
      <span>{props.busy ? "提交中" : props.label}</span>
    </button>
  );
}

function getDangerIcon(
  icon: "ban" | "coins" | "flag" | "gift" | "rotate" | "unlock",
) {
  switch (icon) {
    case "ban":
      return Ban;
    case "coins":
      return Coins;
    case "flag":
      return FlagOff;
    case "gift":
      return Gift;
    case "rotate":
      return RotateCcw;
    case "unlock":
      return LockOpen;
  }
}
