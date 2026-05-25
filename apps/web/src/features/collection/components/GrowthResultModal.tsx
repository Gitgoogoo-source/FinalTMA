import { AlertTriangle, CheckCircle2, Sparkles, X } from "lucide-react";

type GrowthResultMetric = {
  label: string;
  value: string;
  detail?: string | undefined;
};

type GrowthResultModalProps = {
  open: boolean;
  title: string;
  description?: string | undefined;
  metrics: GrowthResultMetric[];
  confirmLabel?: string | undefined;
  headerLabel?: string | undefined;
  tone?: "success" | "warning" | undefined;
  onClose: () => void;
};

export function GrowthResultModal({
  confirmLabel = "确认",
  description,
  headerLabel,
  metrics,
  onClose,
  open,
  tone = "success",
  title,
}: GrowthResultModalProps) {
  if (!open) {
    return null;
  }

  const HeaderIcon = tone === "warning" ? AlertTriangle : CheckCircle2;
  const MarkIcon = tone === "warning" ? AlertTriangle : Sparkles;

  return (
    <div
      className={`growth-result-modal growth-result-modal--${tone}`}
      role="presentation"
    >
      <button
        aria-label="关闭成长结果"
        className="growth-result-modal__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="growth-result-modal-title"
        aria-modal="true"
        className="growth-result-modal__panel"
        role="dialog"
      >
        <header className="growth-result-modal__header">
          <span>
            <HeaderIcon aria-hidden="true" size={17} strokeWidth={2.5} />
            {headerLabel ?? "成长完成"}
          </span>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="growth-result-modal__body">
          <div className="growth-result-modal__mark">
            <MarkIcon aria-hidden="true" size={26} strokeWidth={2.4} />
          </div>
          <h2 id="growth-result-modal-title">{title}</h2>
          {description ? <p>{description}</p> : null}
          <div className="growth-result-modal__metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                {metric.detail ? <em>{metric.detail}</em> : null}
              </div>
            ))}
          </div>
          <button
            className="growth-result-modal__confirm"
            onClick={onClose}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
