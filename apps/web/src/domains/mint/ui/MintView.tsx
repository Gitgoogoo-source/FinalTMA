import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { ChevronLeft, Link2, ShieldAlert } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import {
  useAppNavigate,
  useAppParams,
} from "../../../platform/navigation/index.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import {
  useDormantApiQuery,
  useDormantOperationBlocked,
  useDormantOperationCommands,
} from "../../../dormant/api.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useTelegramBackButton } from "../../../platform/telegram/index.ts";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";

type Transaction = {
  valid_until: number;
  messages: Array<{ address: string; amount: string; payload: string }>;
};

export function MintView(): ReactNode {
  const { templateId = "" } = useAppParams("/mint/:templateId");
  const inventory = useApiQuery("inventory.detail", {
    template_id: templateId,
  });
  const walletStatus = useDormantApiQuery("wallet.get");
  const navigate = useAppNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBackButton(true, back);
  const item = inventory.data;
  const [tonConnect] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const { run } = useDormantOperationCommands();
  const reserveBlocked = useDormantOperationBlocked("mint.reserve");
  const cancelBlocked = useDormantOperationBlocked("mint.cancel");
  const submitBlocked = useDormantOperationBlocked("mint.submit");
  const blocked = reserveBlocked || cancelBlocked || submitBlocked;
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
    const { Cell } = await import("@ton/core");
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
              url={item.image_detail_url}
              alt={item.name}
              variant="detail"
              loading="eager"
              fetchPriority="high"
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
