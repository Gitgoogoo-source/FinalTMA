import { ArrowRight, Gift, Percent } from "lucide-react";

import type { ReferralLink } from "../tasks.types";

type InviteCampaignCardProps = {
  referralLink: ReferralLink | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onShowLink: () => void;
};

export function InviteCampaignCard({
  isGenerating,
  onGenerate,
  onShowLink,
  referralLink,
}: InviteCampaignCardProps) {
  const primaryLabel = isGenerating ? "生成中" : "立即邀请";

  return (
    <section className="invite-campaign-card" aria-labelledby="invite-title">
      <div className="invite-campaign-card__visual" aria-hidden="true">
        <InviteGiftIllustration />
      </div>

      <div className="invite-campaign-card__headline">
        <h2 id="invite-title">
          好友<span>首次</span>开盒
        </h2>
        <p>
          双方奖励 <strong>500</strong> 积分
        </p>
      </div>

      <div className="invite-campaign-card__benefits" aria-label="邀请权益">
        <article>
          <Gift aria-hidden="true" size={21} strokeWidth={2.6} />
          <div>
            <span>首冲奖励:</span>
            <strong>
              双方 <em>+500</em>
            </strong>
          </div>
        </article>
        <article>
          <Percent aria-hidden="true" size={21} strokeWidth={2.6} />
          <div>
            <span>持续分红:</span>
            <strong>
              好友 <em>10%</em>
            </strong>
          </div>
        </article>
      </div>

      <div className="invite-campaign-card__cta-shell">
        <button
          className="invite-campaign-card__primary"
          disabled={isGenerating}
          onClick={referralLink ? onShowLink : onGenerate}
          type="button"
        >
          <span>{primaryLabel}</span>
          <i aria-hidden="true">
            <ArrowRight size={24} strokeWidth={3} />
          </i>
        </button>
      </div>

      <p className="invite-campaign-card__caption">
        永久享受好友开盒积分 <strong>10%</strong> 分红
      </p>
    </section>
  );
}

function InviteGiftIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="invite-gift-illustration"
      focusable="false"
      viewBox="0 0 205 205"
    >
      <defs>
        <linearGradient id="inviteGiftOrange" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
          <stop offset="46%" stopColor="#ffe1c8" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#ff6b00" stopOpacity="0.86" />
        </linearGradient>
        <filter id="inviteGiftGlow" height="170%" width="160%" x="-30%" y="-30%">
          <feGaussianBlur result="blur" stdDeviation="3" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 1 0 0.45 0 0 0.42 0 0 0 0 0 0 0 0 0.38 0"
          />
          <feBlend in="SourceGraphic" />
        </filter>
      </defs>
      <ellipse cx="111" cy="179" fill="rgba(255,121,0,0.12)" rx="76" ry="13" />
      <g filter="url(#inviteGiftGlow)" opacity="0.96">
        <g transform="translate(98 26) rotate(12)">
          <path
            d="M0 35 62 0l68 30-66 37Z"
            fill="rgba(255,255,255,0.56)"
            stroke="#ffa35a"
            strokeWidth="1.4"
          />
          <path
            d="M0 35v43l64 33V67Z"
            fill="rgba(255,255,255,0.42)"
            stroke="#ffa35a"
            strokeWidth="1.2"
          />
          <path
            d="M64 67v44l66-38V30Z"
            fill="rgba(255,184,124,0.36)"
            stroke="#ff7a00"
            strokeWidth="1.2"
          />
          <path
            d="M61 2 64 67M34 16l66 32M92 16 28 54"
            opacity="0.62"
            stroke="#ff7a00"
            strokeWidth="2"
          />
          <path
            d="M78 0c11-20 32-10 20 9 19-10 32 8 12 20"
            fill="none"
            stroke="#ff6b00"
            strokeLinecap="round"
            strokeWidth="9"
          />
        </g>
        <g transform="translate(88 121)">
          <path
            d="M0 20 38 0l45 19-40 23Z"
            fill="url(#inviteGiftOrange)"
            stroke="#ffb072"
          />
          <path
            d="M0 20v43l43 22V42Z"
            fill="rgba(255,255,255,0.5)"
            stroke="#ffb072"
          />
          <path
            d="M43 42v43l40-24V19Z"
            fill="rgba(255,205,169,0.42)"
            stroke="#ff7a00"
          />
          <path
            d="M38 0 43 85M17 11l45 21"
            opacity="0.7"
            stroke="#ff7a00"
            strokeWidth="2.3"
          />
          <path
            d="M31 1c-4-13 13-17 17-4 5-13 22-8 15 5"
            fill="none"
            stroke="#ff7a00"
            strokeLinecap="round"
            strokeWidth="7"
          />
        </g>
        <g transform="translate(132 124)">
          <path
            d="M0 17 34 0l39 18-36 19Z"
            fill="url(#inviteGiftOrange)"
            stroke="#ffb072"
          />
          <path
            d="M0 17v38l37 19V37Z"
            fill="rgba(255,255,255,0.48)"
            stroke="#ffb072"
          />
          <path
            d="M37 37v37l36-21V18Z"
            fill="rgba(255,196,150,0.42)"
            stroke="#ff7a00"
          />
          <path
            d="M33 1 37 74M16 8l42 20"
            opacity="0.68"
            stroke="#ff7a00"
            strokeWidth="2"
          />
        </g>
        <g transform="translate(67 69) rotate(-10)">
          <path
            d="M0 15 30 0l34 16-32 18Z"
            fill="rgba(255,255,255,0.52)"
            stroke="#ffb072"
          />
          <path
            d="M0 15v33l32 17V34Z"
            fill="rgba(255,255,255,0.45)"
            stroke="#ffb072"
          />
          <path
            d="M32 34v31l32-18V16Z"
            fill="rgba(255,198,151,0.4)"
            stroke="#ff7a00"
          />
          <path
            d="M30 1 32 65M13 8l36 18"
            opacity="0.66"
            stroke="#ff7a00"
            strokeWidth="1.8"
          />
        </g>
      </g>
    </svg>
  );
}
