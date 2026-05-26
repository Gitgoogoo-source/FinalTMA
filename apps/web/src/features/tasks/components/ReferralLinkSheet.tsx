import { Copy, Send, X } from "lucide-react";

import type { ReferralLink } from "../tasks.types";

type ReferralLinkSheetProps = {
  open: boolean;
  referralLink: ReferralLink | null;
  isPending: boolean;
  onClose: () => void;
  onCopy: () => void;
  onShare: () => void;
};

export function ReferralLinkSheet({
  isPending,
  onClose,
  onCopy,
  onShare,
  open,
  referralLink,
}: ReferralLinkSheetProps) {
  if (!open || !referralLink) {
    return null;
  }

  return (
    <div className="referral-link-sheet" role="presentation">
      <button
        aria-label="关闭邀请链接"
        className="referral-link-sheet__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="referral-link-title"
        aria-modal="true"
        className="referral-link-sheet__panel"
        role="dialog"
      >
        <header className="referral-link-sheet__header">
          <div>
            <span>邀请链接</span>
            <h2 id="referral-link-title">分享给好友</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="referral-link-sheet__body">
          <code>{referralLink.inviteUrl}</code>
          <p>{referralLink.shareText}</p>
        </div>

        <footer className="referral-link-sheet__actions">
          <button disabled={isPending} onClick={onCopy} type="button">
            <Copy aria-hidden="true" size={16} strokeWidth={2.5} />
            复制
          </button>
          <button disabled={isPending} onClick={onShare} type="button">
            <Send aria-hidden="true" size={16} strokeWidth={2.5} />
            分享
          </button>
        </footer>
      </section>
    </div>
  );
}
