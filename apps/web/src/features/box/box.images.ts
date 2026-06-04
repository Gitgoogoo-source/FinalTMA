import type { BlindBox } from "./box.types";

const LAUNCH_BOX_IMAGES_BY_SLUG: Readonly<Record<string, string>> = {
  starter_egg: "/images/boxes/starter_egg.png",
  premium_egg: "/images/boxes/premium_egg.png",
  legendary_egg: "/images/boxes/legendary_egg.png",
};

type BoxImageSource = Pick<
  BlindBox,
  "coverImageUrl" | "heroImageUrl" | "slug"
>;

export function getBoxHeroImageUrl(box: BoxImageSource): string | null {
  return firstImageUrl(
    LAUNCH_BOX_IMAGES_BY_SLUG[box.slug],
    box.heroImageUrl,
    box.coverImageUrl,
  );
}

export function getBoxCoverImageUrl(box: BoxImageSource): string | null {
  return firstImageUrl(
    LAUNCH_BOX_IMAGES_BY_SLUG[box.slug],
    box.coverImageUrl,
    box.heroImageUrl,
  );
}

function firstImageUrl(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = value?.trim();

    if (normalized) {
      return normalized;
    }
  }

  return null;
}
