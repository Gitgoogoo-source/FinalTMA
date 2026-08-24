import { CheckCircle2, Gift } from "lucide-react";
import type { RouteOutput } from "@pokepets/api-contracts/app-client";
import type { ReactNode } from "react";

import { Button } from "../../shared/ui/Button.tsx";
import { t } from "../../platform/i18n/index.ts";

export function AlbumClaimResultDialog({
  result,
  onConfirm,
}: {
  result: RouteOutput<"album.claim">;
  onConfirm(): void;
}): ReactNode {
  return (
    <div className="modal album-claim-result">
      <CheckCircle2 className="album-claim-success" aria-hidden="true" />
      <div>
        <span>{t("图鉴奖励已到账")}</span>
        <h2 id="album-claim-result-title">{t(result.theme)}</h2>
      </div>
      <p>
        <Gift aria-hidden="true" />
        Gems +{result.reward_fgems}
      </p>
      <Button onClick={onConfirm}>{t("完成")}</Button>
    </div>
  );
}
