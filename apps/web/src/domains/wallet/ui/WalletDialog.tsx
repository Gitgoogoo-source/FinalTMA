import { CheckCircle2, Link2Off, WalletCards } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useIsConnectionRestored,
  useTonConnectUI,
  useTonWallet,
  toUserFriendlyAddress,
} from "@tonconnect/ui-react";

import { apiRequest } from "../../../platform/api/client.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { getSession, useSession } from "../../../platform/session/store.ts";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { tr } from "../../../platform/i18n/index.ts";
import { requestWalletConnection } from "../connection.ts";
import {
  clearPendingWalletConnection,
  readPendingWalletConnection,
  savePendingWalletConnection,
  walletVerificationInput,
  type PendingWalletConnection,
} from "../pending-connection.ts";

export function WalletDialog({ close }: { close(): void }): ReactNode {
  const status = useApiQuery("wallet.get");
  const { data: walletStatus, refetch: refetchWallet } = status;
  const userId = useSession()?.userId;
  const resumed = useRef<string | null>(null);
  const [tonConnect] = useTonConnectUI();
  const wallet = useTonWallet();
  const restored = useIsConnectionRestored();
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<
    "idle" | "opening" | "verifying" | "disconnecting"
  >("idle");
  const [error, setError] = useState("");
  const { run } = useOperationCommands();
  const verifyBlocked = useOperationBlocked("wallet.verify");
  const disconnectBlocked = useOperationBlocked("wallet.disconnect");
  const blocked = verifyBlocked || disconnectBlocked || phase !== "idle";
  const verified = status.data?.connected === true;
  const connected =
    verified &&
    wallet &&
    wallet.account.address.toLowerCase() === status.data?.address &&
    (wallet.account.chain === "-3" ? "testnet" : "mainnet") ===
      status.data?.network;
  const address = status.data?.address
    ? toUserFriendlyAddress(
        status.data.address,
        status.data.network === "testnet",
      )
    : "";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [userId]);

  const connect = useCallback(
    async (restore = false) => {
      if (active.current || blocked || !restored || !userId) return;
      let pending: PendingWalletConnection | null = restore
        ? readPendingWalletConnection(userId)
        : null;
      if (restore && !pending) return;
      const controller = new AbortController();
      active.current = controller;
      setError("");
      setPhase("opening");
      try {
        if (!restore) {
          if (tonConnect.connected) await tonConnect.disconnect();
          const { data: challenge } = await apiRequest(
            "wallet.challenge",
            {},
            { signal: controller.signal },
          );
          if (controller.signal.aborted || getSession()?.userId !== userId)
            return;
          pending = {
            userId,
            payload: challenge.payload,
            expiresAt: Date.parse(challenge.expires_at),
          };
          savePendingWalletConnection(pending);
        }
        if (!pending) return;
        const request = pending;
        resumed.current = request.payload;
        const remaining = request.expiresAt - Date.now();
        if (remaining <= 0) throw new Error("WALLET_CONNECTION_EXPIRED");
        const connection = await requestWalletConnection(
          tonConnect,
          controller.signal,
          remaining,
          {
            restore,
            beforeOpen: () => {
              if (getSession()?.userId !== userId || controller.signal.aborted)
                throw new Error("WALLET_CONNECTION_CANCELLED");
              tonConnect.setConnectRequestParameters({
                state: "ready",
                value: { tonProof: request.payload },
              });
            },
          },
        );
        if (controller.signal.aborted || getSession()?.userId !== userId)
          return;
        const current = readPendingWalletConnection(userId);
        if (current?.payload !== request.payload)
          throw new Error("WALLET_CONNECTION_EXPIRED");
        const input = walletVerificationInput(
          connection,
          request,
          getSession()?.userId,
        );
        // A request may already have committed before the WebView was reloaded.
        const sameWallet = (data: typeof walletStatus) =>
          data?.connected &&
          data.address === input.account.address.toLowerCase() &&
          data.network ===
            (input.account.chain === "-3" ? "testnet" : "mainnet");
        if (restore && sameWallet(walletStatus)) {
          clearPendingWalletConnection(request);
          return;
        }
        setPhase("verifying");
        const result = await run(
          tr("Verifying TON wallet", "正在验证 TON 钱包"),
          "wallet.verify",
          input,
          { dialog: false },
        );
        if (result) clearPendingWalletConnection(request);
        const refreshed = await refetchWallet();
        if (sameWallet(refreshed.data)) clearPendingWalletConnection(request);
        else if (!result && mounted.current && !controller.signal.aborted)
          setError(
            tr(
              "Wallet verification was not completed. Check the operation status before trying again.",
              "钱包验证尚未完成，请先查看操作状态再重试。",
            ),
          );
      } catch (cause) {
        if (mounted.current && !controller.signal.aborted) {
          if (pending) clearPendingWalletConnection(pending);
          setError(connectionError(cause));
        }
      } finally {
        if (active.current === controller) {
          tonConnect.setConnectRequestParameters(null);
          active.current = null;
          if (mounted.current) setPhase("idle");
        }
      }
    },
    [blocked, restored, userId, tonConnect, run, walletStatus, refetchWallet],
  );

  useEffect(() => {
    let cancelled = false;
    // Let StrictMode's mount/cleanup cycle finish before starting side effects.
    queueMicrotask(() => {
      if (cancelled || status.isLoading || status.error || !restored || blocked)
        return;
      const pending = readPendingWalletConnection(userId);
      if (pending && resumed.current !== pending.payload) void connect(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, restored, blocked, status.isLoading, status.error, connect]);

  const closeWallet = () => {
    const pending = readPendingWalletConnection(userId);
    if (pending) clearPendingWalletConnection(pending);
    active.current?.abort();
    close();
  };
  const disconnect = async () => {
    if (active.current || blocked) return;
    const controller = new AbortController();
    active.current = controller;
    const pending = readPendingWalletConnection(userId);
    if (pending) clearPendingWalletConnection(pending);
    setError("");
    setPhase("disconnecting");
    try {
      const result = verified
        ? await run(
            tr("Disconnecting TON wallet", "正在断开 TON 钱包"),
            "wallet.disconnect",
            {},
            { dialog: false },
          )
        : true;
      if (!result) {
        setError(
          tr(
            "Disconnection is not confirmed. Check the operation status and try again.",
            "尚未确认断开，请查看操作状态后重试。",
          ),
        );
        return;
      }
      if (tonConnect.connected) await tonConnect.disconnect();
    } catch {
      if (mounted.current)
        setError(
          tr(
            "Could not close the wallet session. Please retry.",
            "钱包会话未能关闭，请重试。",
          ),
        );
    } finally {
      await status.refetch();
      active.current = null;
      if (mounted.current) setPhase("idle");
    }
  };
  return (
    <AppModal
      labelledBy="wallet-dialog-title"
      onClose={
        phase === "verifying" || phase === "disconnecting"
          ? undefined
          : closeWallet
      }
    >
      <div className="modal wallet">
        <WalletCards size={38} aria-hidden="true" />
        <h2 id="wallet-dialog-title">{tr("TON Wallet", "TON 钱包")}</h2>
        {status.isLoading || !restored ? (
          <p role="status">{tr("Loading wallet…", "正在加载钱包…")}</p>
        ) : status.error ? (
          <>
            <p role="alert">
              {tr("Could not load your wallet.", "无法加载钱包状态。")}
            </p>
            <Button onClick={() => void status.refetch()}>
              {tr("Retry", "重试")}
            </Button>
          </>
        ) : (
          <>
            <Badge>
              {connected
                ? tr("Connected", "已连接")
                : verified
                  ? tr("Linked to your account", "已绑定账号")
                  : tr("Not connected", "未连接")}
            </Badge>
            {verified ? (
              <div className="verified-wallet">
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <strong>{`${address.slice(0, 6)}…${address.slice(-6)}`}</strong>
                  <small>
                    {status.data?.wallet_app_name ?? "TON Wallet"} ·{" "}
                    {status.data?.network}
                  </small>
                  <code>{address}</code>
                </div>
              </div>
            ) : (
              <p>
                {tr(
                  "Connect your TON wallet and confirm ownership in your wallet app.",
                  "连接 TON 钱包，并在钱包中确认地址归属。",
                )}
              </p>
            )}
            {!connected ? (
              <Button disabled={blocked} onClick={() => void connect()}>
                {phase === "opening"
                  ? tr("Confirm in your wallet…", "请在钱包中确认…")
                  : phase === "verifying"
                    ? tr("Verifying…", "正在验证…")
                    : verified
                      ? tr("Reconnect wallet", "重新连接钱包")
                      : tr("Connect wallet", "连接钱包")}
              </Button>
            ) : null}
            {verified || wallet ? (
              <Button
                className="secondary"
                disabled={blocked}
                onClick={() => void disconnect()}
              >
                <Link2Off size={18} />
                {tr("Disconnect wallet", "断开钱包")}
              </Button>
            ) : null}
          </>
        )}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          className="secondary"
          disabled={phase === "verifying" || phase === "disconnecting"}
          onClick={closeWallet}
        >
          {tr("Close", "关闭")}
        </Button>
      </div>
    </AppModal>
  );
}

function connectionError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "WALLET_CONNECTION_CANCELLED")
    return tr(
      "Connection cancelled. You can try again.",
      "已取消连接，可以重试。",
    );
  if (code === "WALLET_CONNECTION_EXPIRED")
    return tr(
      "Connection timed out. Please try again.",
      "连接已超时，请重试。",
    );
  if (code === "WALLET_PROOF_MISSING")
    return tr(
      "Your wallet did not confirm ownership. Please reconnect.",
      "钱包未返回地址归属验证，请重新连接。",
    );
  return tr(
    "Could not connect your wallet. Check your connection and try again.",
    "钱包连接失败，请检查网络后重试。",
  );
}
