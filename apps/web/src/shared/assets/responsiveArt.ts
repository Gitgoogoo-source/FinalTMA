export type BoxArtTier = "normal" | "rare" | "legendary";

type BoxArtWidth = 128 | 192 | 384 | 768 | 1024;
type InviteGiftArtWidth = 256 | 512 | 768;

export const boxHeroSizes = "(max-width: 430px) 89vw, 341px";
export const boxThumbnailSizes = "50px";
export const inviteGiftArtSizes = "(max-width: 430px) 49vw, 200px";

const boxHeroWidths = [384, 768, 1024] as const;
const boxThumbnailWidths = [128, 192] as const;
const inviteGiftArtWidths = [256, 512, 768] as const;
const preloadedBoxHeroArt = new Map<BoxArtTier, HTMLImageElement>();

export function boxArtUrl(tier: BoxArtTier, width: BoxArtWidth): string {
  return `/assets/boxes/responsive/${tier}-${width}.webp`;
}

export function fallbackToOriginalBoxArt(
  image: HTMLImageElement,
  tier: BoxArtTier,
): boolean {
  if (image.dataset.originalBoxArtFallback === "true") return false;
  image.dataset.originalBoxArtFallback = "true";
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = `/assets/boxes/${tier}.webp`;
  return true;
}

export function boxHeroSrcSet(tier: BoxArtTier): string {
  return boxHeroWidths
    .map((width) => `${boxArtUrl(tier, width)} ${width}w`)
    .join(", ");
}

export function boxThumbnailSrcSet(tier: BoxArtTier): string {
  return boxThumbnailWidths
    .map((width) => `${boxArtUrl(tier, width)} ${width}w`)
    .join(", ");
}

export function preloadBoxHeroArt(tier: BoxArtTier): void {
  if (typeof Image === "undefined" || preloadedBoxHeroArt.has(tier)) return;
  const image = new Image();
  preloadedBoxHeroArt.set(tier, image);
  image.decoding = "async";
  image.sizes = boxHeroSizes;
  image.srcset = boxHeroSrcSet(tier);
  image.src = boxArtUrl(tier, 768);
  image.addEventListener(
    "error",
    () => {
      if (preloadedBoxHeroArt.get(tier) === image)
        preloadedBoxHeroArt.delete(tier);
    },
    { once: true },
  );
}

export function inviteGiftArtUrl(width: InviteGiftArtWidth): string {
  return `/assets/tasks/invite-gifts-${width}.webp`;
}

export function inviteGiftArtSrcSet(): string {
  return inviteGiftArtWidths
    .map((width) => `${inviteGiftArtUrl(width)} ${width}w`)
    .join(", ");
}
