import { Crown, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app-client";

import { Button } from "../../shared/ui/Button.tsx";
import { localized, t, tp } from "../../platform/i18n/index.ts";

type VipDailyClaimResult =
  | RouteOutput<"vip.claim_fgems">
  | RouteOutput<"vip.claim_free_box">;

const rewardVisuals = localized({
  fgems: {
    image: "/assets/vip/daily-fgems.png",
    label: "Fgems",
    detail: "已存入 Fgems 余额",
  },
  free_rare_box: {
    image: "/assets/vip/vip-free-rare-ticket.webp",
    label: "免费稀有盲盒资格",
    detail: "可在盲盒页面使用",
  },
} as const);

export function VipDailyClaimResultDialog({
  result,
  onConfirm,
}: {
  result: VipDailyClaimResult;
  onConfirm(): void;
}): ReactNode {
  const visual = rewardVisuals[result.kind];

  return (
    <div
      className={`modal result-sheet-modal vip-claim-result-modal reward-${result.kind}`}
    >
      <div className="vip-claim-result-scene" aria-hidden="true">
        <img
          className="vip-claim-result-gift"
          src="/assets/wheel/gift-box.webp"
          alt=""
        />
        <img className="vip-claim-result-reward" src={visual.image} alt="" />
      </div>

      <span className="vip-claim-result-handle" aria-hidden="true" />

      <div className="vip-claim-result-badge">
        <Crown aria-hidden="true" />
        <span>{t("VIP 专属")}</span>
      </div>

      <header className="vip-claim-result-heading">
        <Sparkles aria-hidden="true" />
        <h2 id="vip-claim-result-title">{t("每日好礼已领取")}</h2>
        <Sparkles aria-hidden="true" />
      </header>

      <section
        className="vip-claim-result-summary"
        aria-label={tp("{{0}}，增加 {{1}}", [visual.label, result.amount])}
      >
        <strong>
          {visual.label}
          <span>+{result.amount}</span>
        </strong>
        <p>{visual.detail}</p>
      </section>

      <Button
        className="result-sheet-confirm vip-claim-result-confirm"
        onClick={onConfirm}
      >
        {t("收下奖励")}
      </Button>
    </div>
  );
}
