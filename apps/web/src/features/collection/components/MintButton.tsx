import { BadgeCheck, ChevronRight, Loader2 } from "lucide-react";

type MintButtonProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick?: () => void;
};

export function MintButton({
  className = "character-detail-action character-detail-action--secondary",
  disabled = false,
  label,
  loading = false,
  onClick,
}: MintButtonProps) {
  return (
    <button
      className={className}
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {loading ? (
        <Loader2 aria-hidden="true" size={15} strokeWidth={2.5} />
      ) : (
        <BadgeCheck aria-hidden="true" size={15} strokeWidth={2.5} />
      )}
      {loading ? "提交中" : label}
      <ChevronRight aria-hidden="true" size={14} strokeWidth={2.5} />
    </button>
  );
}
