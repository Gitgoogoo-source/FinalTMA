import { Cell } from "@ton/core";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { ChevronLeft, Link2, ShieldAlert } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useTelegramBackButton } from "../../../platform/telegram/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

type Transaction = {
  valid_until: number;
  messages: Array<{ address: string; amount: string; payload: string }>;
};

export function MintView(): ReactNode {
  const { templateId = "" } = useParams();
  const inventory = useApiQuery("inventory.detail", {
    template_id: templateId,
  });
  const walletStatus = useApiQuery("wallet.get");
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBackButton(true, back);
  const item = inventory.data;
  const [tonConnect] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const { isBlocked, run } = useOperationRegistry();
  const blocked =
    isBlocked("mint.reserve") ||
    isBlocked("mint.cancel") ||
    isBlocked("mint.submit");
  const [imageReady, setImageReady] = useState(false);

  const mint = async () => {
    const reserved = await run(
      "正在锁定 1 个藏品并签发 Mint 凭证",
      "mint.reserve",
      { template_id: templateId },
    );
    if (!reserved) return;
    const mintId = reserved.mint.id;
    const signed = JSON.parse(reserved.permit) as { transaction: Transaction };
    const transaction = signed.transaction;
    let result: Awaited<ReturnType<typeof tonConnect.sendTransaction>>;
    try {
      result = await tonConnect.sendTransaction({
        validUntil: transaction.valid_until,
        messages: transaction.messages,
      });
    } catch {
      await run("正在取消未提交的 Mint", "mint.cancel", { mint_id: mintId });
      return;
    }
    const messageHash = Cell.fromBase64(result.boc).hash().toString("hex");
    await run("交易已提交，正在等待链上确认", "mint.submit", {
      mint_id: mintId,
      transaction_hash: messageHash,
    });
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
              alt={item.name}
              onAvailability={setImageReady}
            />
            <Badge>
              {item.rarity} · 第 {item.stage} 阶
            </Badge>
            <h2>{item.name}</h2>
            <div className="mint-checks">
              <p>
                <span>游戏内可用数量</span>
                <strong>{item.available}</strong>
              </p>
              <p>
                <span>TON 主钱包</span>
                <strong>
                  {walletStatus.data?.connected
                    ? walletStatus.data.address
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
                item.available < 1 ||
                !walletStatus.data?.connected ||
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
