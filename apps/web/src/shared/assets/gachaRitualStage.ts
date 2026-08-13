export const gachaRitualStageBackground =
  "/assets/gacha/ritual/v1/moonlit-prism-garden-b1291c69.webp";

let preloadedStageBackground: HTMLImageElement | null = null;

export function preloadGachaRitualStageBackground(): void {
  if (typeof Image === "undefined" || preloadedStageBackground) return;

  const image = new Image();
  preloadedStageBackground = image;
  image.decoding = "async";
  image.fetchPriority = "high";
  image.addEventListener(
    "load",
    () => {
      void image.decode().catch(() => {
        if (preloadedStageBackground === image) preloadedStageBackground = null;
      });
    },
    { once: true },
  );
  image.addEventListener(
    "error",
    () => {
      if (preloadedStageBackground === image) preloadedStageBackground = null;
    },
    { once: true },
  );
  image.src = gachaRitualStageBackground;
}
