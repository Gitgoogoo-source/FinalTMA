import { CheckCircle2, Link2Off, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { text } from "../../shared/lib/data.ts";
import { Badge, Button } from "../../shared/ui/index.tsx";

type Challenge = { payload: string; expiresAt: string };

export function WalletDialog({ close }: { close(): void }): ReactNode {
  const status = useApiQuery("wallet.status");
  const [tonConnect] = useTonConnectUI();
  const wallet = useTonWallet();
  const pending = useRef<Challenge | null>(null);
  const [phase, setPhase] = useState<"idle" | "opening" | "verifying">("idle");
  const [error, setError] = useState("");
  const { blocked, run } = useOperation();

  useEffect(() => {
    if (!wallet || !pending.current || phase !== "opening") return;
    const connection = wallet as unknown as {
      account: Record<string, unknown>;
      connectItems?: { tonProof?: { proof?: Record<string, unknown> } };
    };
    const proof = connection.connectItems?.tonProof?.proof;
    if (!proof) {
      queueMicrotask(() => {
        setError("钱包未返回 TON Proof，请重新连接");
        setPhase("idle");
      });
      return;
    }
    queueMicrotask(() => setPhase("verifying"));
    void run("正在验证 TON 钱包", async () => {
      await apiRequest(
        "wallet.connect",
        {
          account: connection.account,
          wallet_app_name: (
            wallet as unknown as { device?: { appName?: string } }
          ).device?.appName,
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      const response = await apiRequest(
        "wallet.proof",
        {
          account: connection.account,
          proof,
          wallet_app_name: (
            wallet as unknown as { device?: { appName?: string } }
          ).device?.appName,
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      pending.current = null;
      setPhase("idle");
      return { data: response.data, operationId: response.operationId };
    });
  }, [phase, run, wallet]);

  const connect = async () => {
    setError("");
    setPhase("opening");
    try {
      const response = await apiRequest("wallet.challenge", {});
      const payload = text(response.data.ton_proof_payload, "");
      pending.current = { payload, expiresAt: text(response.data.expires_at) };
      tonConnect.setConnectRequestParameters({
        state: "ready",
        value: { tonProof: payload },
      });
      await tonConnect.openModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "钱包连接失败");
      setPhase("idle");
    }
  };
  const disconnect = () =>
    void run("正在断开 TON 钱包", async () => {
      const response = await apiRequest(
        "wallet.disconnect",
        {},
        { idempotencyKey: newIdempotencyKey() },
      );
      await tonConnect.disconnect();
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <div className="modal-backdrop">
      <div className="modal wallet">
        <WalletCards size={42} />
        <Badge>{status.data?.verified ? "已验证" : "未连接"}</Badge>
        <h2>TON 主钱包</h2>
        {status.isLoading ? (
          <p>正在读取钱包状态</p>
        ) : status.error ? (
          <Button onClick={() => void status.refetch()}>重新加载</Button>
        ) : status.data?.verified ? (
          <>
            <div className="verified-wallet">
              <CheckCircle2 />
              <div>
                <strong>{shortAddress(text(status.data.address))}</strong>
                <small>
                  {text(status.data.walletAppName)} ·{" "}
                  {text(status.data.network)}
                </small>
              </div>
            </div>
            <p>该地址是当前账号唯一经过 TON Proof 验证的主钱包。</p>
            <Button className="danger" disabled={blocked} onClick={disconnect}>
              <Link2Off />
              断开钱包
            </Button>
          </>
        ) : (
          <>
            <ShieldCheck size={34} />
            <p>
              连接钱包后必须完成 TON Proof；钱包地址不能替代 Telegram 登录。
            </p>
            <Button
              disabled={blocked || phase !== "idle"}
              onClick={() => void connect()}
            >
              {phase === "opening"
                ? "请在钱包中确认"
                : phase === "verifying"
                  ? "正在验证"
                  : "连接并验证钱包"}
            </Button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <Button className="secondary" onClick={close}>
          关闭
        </Button>
      </div>
    </div>
  );
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-6)}` : value;
}
