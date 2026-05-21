import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import type { FeedbackToast } from "../feedback.types";

type ResultToastProps = {
  toast: FeedbackToast;
  onDismiss: (toastId: string) => void;
};

const TOAST_META = {
  success: {
    icon: CheckCircle2,
    ariaRole: "status",
  },
  error: {
    icon: AlertCircle,
    ariaRole: "alert",
  },
  info: {
    icon: Info,
    ariaRole: "status",
  },
} as const;

export function ResultToast({ toast, onDismiss }: ResultToastProps) {
  const meta = TOAST_META[toast.type];
  const Icon = meta.icon;

  return (
    <button
      className={`feedback-toast result-toast feedback-toast--${toast.type} result-toast--${toast.type}`}
      onClick={() => onDismiss(toast.id)}
      role={meta.ariaRole}
      type="button"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={2.5} />
      <span className="result-toast__copy">
        <strong>{toast.title}</strong>
        {toast.message ? <span>{toast.message}</span> : null}
      </span>
    </button>
  );
}
