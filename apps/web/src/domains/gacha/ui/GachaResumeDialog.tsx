import { Coins, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

import {
  boxArtUrl,
  boxThumbnailSrcSet,
  fallbackToOriginalBoxArt,
  type BoxArtTier,
} from "../../../shared/assets/responsiveArt.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Button } from "../../../shared/ui/Button.tsx";

export function GachaResumeDialog({
  tier,
  displayName,
  drawCount,
  cost,
  freeSingle,
  disabled,
  onPrepare,
  onClose,
  onConfirm,
}: {
  tier: BoxArtTier;
  displayName: string;
  drawCount: 1 | 10;
  cost: number;
  freeSingle: boolean;
  disabled: boolean;
  onPrepare: () => void;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <AppModal
      className="gacha-resume-dialog-backdrop"
      labelledBy="gacha-resume-dialog-title"
      onClose={onClose}
    >
      <section className="modal gacha-resume-dialog">
        <button
          type="button"
          className="gacha-resume-close"
          aria-label="关闭开盒确认"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        <div className="gacha-resume-art" aria-hidden="true">
          <Sparkles className="gacha-resume-sparkles" />
          <img
            className="catalog-image"
            src={boxArtUrl(tier, 192)}
            srcSet={boxThumbnailSrcSet(tier)}
            sizes="104px"
            alt=""
            decoding="async"
            onError={(event) =>
              void fallbackToOriginalBoxArt(event.currentTarget, tier)
            }
          />
        </div>
        <header className="gacha-resume-copy">
          <h2 id="gacha-resume-dialog-title">开启{displayName}？</h2>
          <p className="gacha-resume-cost">
            <Coins aria-hidden="true" />
            <span>
              {drawCount === 10
                ? `十连 · 消耗 ${cost} K-coin`
                : freeSingle
                  ? "单抽 · 本次免费"
                  : `消耗 ${cost} K-coin`}
            </span>
          </p>
        </header>
        <Button
          className="gacha-resume-confirm"
          disabled={disabled}
          aria-disabled={disabled}
          onPointerDown={onPrepare}
          onFocus={onPrepare}
          onClick={onConfirm}
        >
          确认开盒
        </Button>
      </section>
    </AppModal>
  );
}
