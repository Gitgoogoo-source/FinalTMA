import { useEffect, useRef } from "react";
import { useSession } from "../../platform/session/store.ts";
import { readPendingWalletConnection } from "./pending-connection.ts";

// This hook runs in the deferred recovery coordinator, after Telegram auth.
// It opens the lazy wallet capability only when this account has unfinished work.
export function useWalletConnectionResume(
  open: (dialog: "wallet") => void,
): void {
  const session = useSession();
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (
      session?.accountStatus !== "normal" ||
      session.entryHandoffState !== "complete"
    )
      return;
    const pending = readPendingWalletConnection(session.userId);
    if (pending && resumed.current !== pending.payload) {
      resumed.current = pending.payload;
      open("wallet");
    }
  }, [session, open]);
}
