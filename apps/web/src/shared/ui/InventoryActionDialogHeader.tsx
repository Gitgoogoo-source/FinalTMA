import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function InventoryActionDialogHeader({
  titleId,
  title,
  subtitle,
  showHandle = false,
}: {
  titleId: string;
  title: string;
  subtitle: string;
  showHandle?: boolean;
}): ReactNode {
  return (
    <header
      className={`inventory-action-dialog-heading ${showHandle ? "has-handle" : ""}`.trim()}
    >
      <img
        className="inventory-action-dialog-clouds"
        src="/assets/inventory/dialogs/inventory-action-clouds-v1.png"
        alt=""
        aria-hidden="true"
      />
      {showHandle ? (
        <span className="inventory-action-dialog-handle" aria-hidden="true" />
      ) : null}
      <div className="inventory-action-dialog-title">
        <Sparkles aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        <Sparkles aria-hidden="true" />
      </div>
      <small>{subtitle}</small>
    </header>
  );
}
