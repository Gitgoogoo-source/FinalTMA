import { Copy, ExternalLink, Gift, Link2, Send, Sparkles } from "lucide-react";

import type { ReferralLink } from "../tasks.types";
import { InviteButton } from "./InviteButton";

type InviteCampaignCardProps = {
  referralLink: ReferralLink | null;
  isGenerating: boolean;
  isSharing: boolean;
  onCopy: () => void;
  onGenerate: () => void;
  onShare: () => void;
  onShowLink: () => void;
};

export function InviteCampaignCard({
  isGenerating,
  isSharing,
  onCopy,
  onGenerate,
  onShare,
  onShowLink,
  referralLink,
}: InviteCampaignCardProps) {
  return (
    <section className="invite-campaign-card" aria-labelledby="invite-title">
      <div className="invite-campaign-card__hero">
        <div className="invite-campaign-card__copy">
          <span>邀请活动</span>
          <h2 id="invite-title">邀请好友首次开盒</h2>
          <p>好友完成首次开盒后，奖励和分红由后端结算。</p>
        </div>

        <div className="invite-campaign-card__art" aria-hidden="true">
          <span />
          <span />
          <Gift size={34} strokeWidth={2.4} />
          <Sparkles size={18} strokeWidth={2.6} />
        </div>
      </div>

      <div className="invite-campaign-card__benefits" aria-label="邀请权益">
        <span>
          <strong>首开奖励</strong>
          <em>双方可得</em>
        </span>
        <span>
          <strong>分红收益</strong>
          <em>后端结算</em>
        </span>
      </div>

      <div className="invite-campaign-card__actions">
        <InviteButton
          disabled={isGenerating}
          icon={referralLink ? ExternalLink : Link2}
          isPending={isGenerating}
          label={referralLink ? "查看链接" : "生成链接"}
          onClick={referralLink ? onShowLink : onGenerate}
        />
        <InviteButton
          disabled={!referralLink || isGenerating}
          icon={Send}
          isPending={isSharing}
          label="分享"
          onClick={onShare}
        />
        <InviteButton
          disabled={!referralLink || isGenerating}
          icon={Copy}
          isPending={isSharing}
          label="复制"
          onClick={onCopy}
        />
      </div>
    </section>
  );
}
