import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

type InviteButtonProps = {
  label: string;
  icon: ComponentType<LucideProps>;
  disabled?: boolean;
  isPending?: boolean;
  onClick: () => void;
};

export function InviteButton({
  disabled = false,
  icon: Icon,
  isPending = false,
  label,
  onClick,
}: InviteButtonProps) {
  return (
    <button
      className="invite-button"
      disabled={disabled || isPending}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2.5} />
      {label}
    </button>
  );
}
