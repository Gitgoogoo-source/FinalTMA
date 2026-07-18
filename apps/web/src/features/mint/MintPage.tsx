import { Cell } from "@ton/core";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { ChevronLeft, Link2, ShieldAlert } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useTelegramBackButton } from "../../platform/telegram/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { number, records, text } from "../../shared/lib/data.ts";
import {
  Badge,
  Button,
  Card,
  CatalogImage,
  PageState,
} from "../../shared/ui/index.tsx";

type Transaction = {
  valid_until: number;
  messages: Array<{ address: string; amount: string; payload: string }>;
};

export function MintPage(): ReactNode {
  const { templateId = "" } = useParams();
  const inventory = useApiQuery("inventory.detail", {
    template_id: templateId,
  });
  const walletStatus = useApiQuery("wallet.status");
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBackButton(true, back);
  const item = useMemo(
    () =>
      records(inventory.data?.items).find(
        (candidate) => candidate.template_id === templateId,
      ),
    [inventory.data, templateId],
  );
  const [tonConnect] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const { blocked, run } = useOperation();
  const [imageReady, setImageReady] = useState(false);

  const mint = async () => {
    const reserved = await run(
      "正在锁定 1 个藏品并签发 Mint 凭证",
      async () => {
        const response = await apiRequest(
          "wallet.mint",
          { action: "reserve", template_id: templateId },
          { idempotencyKey: newIdempotencyKey() },
        );
        return { data: response.data, operationId: response.operationId };
      },
    );
    if (!reserved) return;
    const mintId = text(reserved.mint_id, "");
    try {
      const transaction = reserved.transaction as Transaction;
      const result = await tonConnect.sendTransaction({
        validUntil: transaction.valid_until,
        messages: transaction.messages,
      });
      const messageHash = Cell.fromBase64(result.boc).hash().toString("hex");
      await run("交易已提交，正在等待链上确认", async () => {
        const response = await apiRequest(
          "wallet.mint",
          { action: "submit", mint_id: mintId, transaction_hash: messageHash },
          { idempotencyKey: newIdempotencyKey() },
        );
        return { data: response.data, operationId: response.operationId };
      });
    } catch {
      await run("正在取消未提交的 Mint", async () => {
        const response = await apiRequest(
          "wallet.mint",
          { action: "cancel", mint_id: mintId },
          { idempotencyKey: newIdempotencyKey() },
        );
        return { data: response.data, operationId: response.operationId };
      });
    }
  };
  return (
    <main className="page fullscreen">
      <header className="page-heading">
        <Button className="icon-only" onClick={back}>
          <ChevronLeft />
        </Button>
        <div>
          <span>TON NFT</span>
          <h1>Mint 上链</h1>
        </div>
      </header>
      <PageState
        loading={inventory.isLoading || walletStatus.isLoading}
        error={(inventory.error ?? walletStatus.error) as Error | null}
        onRetry={() => {
          void inventory.refetch();
          void walletStatus.refetch();
        }}
        empty={!item}
      >
        {item && (
          <Card className="mint-card">
            <CatalogImage
              path={item.image_path}
              alt={text(item.name)}
              onAvailability={setImageReady}
            />
            <Badge>
              {text(item.rarity)} · 第 {text(item.stage)} 阶
            </Badge>
            <h2>{text(item.name)}</h2>
            <div className="mint-checks">
              <p>
                <span>游戏内可用数量</span>
                <strong>{text(item.available)}</strong>
              </p>
              <p>
                <span>TON 主钱包</span>
                <strong>
                  {walletStatus.data?.verified
                    ? text(walletStatus.data.address)
                    : "未验证"}
                </strong>
              </p>
              <p>
                <span>Mint 数量</span>
                <strong>1</strong>
              </p>
            </div>
            <div className="notice">
              <ShieldAlert />
              <p>
                确认后先原子锁定一个藏品，再由当前已验证钱包提交交易并支付 TON
                网络费。链上成功前不显示 NFT 已到账。
              </p>
            </div>
            <Button
              disabled={
                blocked ||
                !imageReady ||
                number(item.available) < 1 ||
                !walletStatus.data?.verified ||
                !tonWallet
              }
              onClick={() => void mint()}
            >
              <Link2 />
              确认 Mint 1 个藏品
            </Button>
          </Card>
        )}
      </PageState>
    </main>
  );
}
