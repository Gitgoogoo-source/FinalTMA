import { AlertTriangle, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { shortId } from "../admin.ui";

export type DangerConfirmation = {
  reason: string;
  targetCode: string;
};

type ConfirmDangerDialogProps = {
  confirmLabel?: string | undefined;
  description?: string | undefined;
  isOpen: boolean;
  pending?: boolean;
  targetLabel: string;
  targetValue: string;
  title: string;
  onCancel: () => void;
  onConfirm: (confirmation: DangerConfirmation) => void | Promise<void>;
};

export function ConfirmDangerDialog(props: ConfirmDangerDialogProps) {
  const [reason, setReason] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const expectedCode = useMemo(
    () => buildDangerTargetCode(props.targetValue),
    [props.targetValue],
  );

  useEffect(() => {
    if (!props.isOpen) {
      setReason("");
      setTargetCode("");
      setLocalError(null);
    }
  }, [props.isOpen]);

  if (!props.isOpen) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!reason.trim()) {
      setLocalError("必须填写操作原因");
      return;
    }

    if (targetCode.trim() !== expectedCode) {
      setLocalError("目标确认码不匹配");
      return;
    }

    setLocalError(null);
    await props.onConfirm({
      reason: reason.trim(),
      targetCode: targetCode.trim(),
    });
  }

  return (
    <div className="danger-dialog-backdrop" role="presentation">
      <form
        aria-modal="true"
        className="danger-dialog"
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <div className="danger-dialog__header">
          <span className="danger-dialog__icon">
            <AlertTriangle aria-hidden="true" size={20} />
          </span>
          <div>
            <h2>{props.title}</h2>
            {props.description ? <p>{props.description}</p> : null}
          </div>
          <button
            className="icon-only-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="danger-dialog__target">
          <span>
            <small>{props.targetLabel}</small>
            <strong>{shortId(props.targetValue)}</strong>
          </span>
          <span>
            <small>确认码</small>
            <strong>{expectedCode}</strong>
          </span>
        </div>

        <label>
          <span>原因</span>
          <textarea
            disabled={props.pending}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </label>
        <label>
          <span>输入确认码</span>
          <input
            disabled={props.pending}
            onChange={(event) => setTargetCode(event.target.value)}
            value={targetCode}
          />
        </label>

        {localError ? (
          <p className="notice notice--error">{localError}</p>
        ) : null}

        <div className="button-row">
          <button
            className="text-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="icon-button icon-button--danger"
            disabled={props.pending}
            type="submit"
          >
            <AlertTriangle aria-hidden="true" size={16} />
            <span>
              {props.pending ? "提交中" : (props.confirmLabel ?? "确认")}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

export function buildDangerTargetCode(value: string): string {
  const normalized = value.trim();

  if (normalized.length <= 8) {
    return normalized;
  }

  return normalized.slice(-6);
}
