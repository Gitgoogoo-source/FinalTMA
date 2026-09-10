import { useEffect } from "react";
import type { GlobalDialog } from "./TopAssetBar.tsx";

export function useGlobalDialogReload(
  open: (kind: GlobalDialog) => void,
): void {
  useEffect(() => {
    try {
      const kind = sessionStorage.getItem("evomypet.dialog-reload");
      sessionStorage.removeItem("evomypet.dialog-reload");
      if (
        kind === "account" ||
        kind === "wallet" ||
        kind === "vip" ||
        kind === "topup"
      )
        open(kind);
    } catch {
      /* Session storage is optional. */
    }
  }, [open]);
}
