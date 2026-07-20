import { CheckCircle2, Gift } from "lucide-react";
import type { RouteOutput } from "@pokepets/api-contracts/app";
import type { ReactNode } from "react";

import { Button } from "../../shared/ui/index.tsx";

export function AlbumClaimResultDialog({
  operationId,
  result,
  onConfirm,
}: {
  operationId: string;
  result: RouteOutput<"album.claim">;
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal album-claim-result">
      <CheckCircle2 className="album-claim-success" aria-hidden="true" />
      <div>
        <span>图鉴奖励已到账</span>
        <h2 id="album-claim-result-title">{result.theme}</h2>
      </div>
      <p>
        <Gift aria-hidden="true" />
        Fgems +{result.reward_fgems}
      </p>
      <code>操作号 {operationId}</code>
      <Button onClick={onConfirm}>完成</Button>
    </div>
  );
}
