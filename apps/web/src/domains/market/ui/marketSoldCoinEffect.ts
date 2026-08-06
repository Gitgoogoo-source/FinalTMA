export const SOLD_CARD_DISMISS_DELAY_MS = 600;
export const SOLD_COIN_EFFECT_DURATION_MS = 900;

const VIEWPORT_BOTTOM_GUTTER = 82;
const VIEWPORT_SIDE_GUTTER = 24;

const SPREAD_POINTS = [
  [0.22, 0.04],
  [0.58, 0.09],
  [0.82, 0.17],
  [0.08, 0.3],
  [0.46, 0.31],
  [0.91, 0.37],
  [0.24, 0.5],
  [0.7, 0.52],
  [0.08, 0.68],
  [0.54, 0.7],
  [0.86, 0.79],
  [0.3, 0.92],
] as const;

type Point = {
  x: number;
  y: number;
};

export type MarketSoldCoinBurst = {
  id: string;
  source: Point;
  target: Point;
  spread: readonly Point[];
};

export function createMarketSoldCoinBurst(
  saleSequence: string,
  trigger: HTMLButtonElement,
): MarketSoldCoinBurst | null {
  const target = document.querySelector<HTMLElement>("[data-kcoin-target]");
  const shell = trigger.closest(".app-shell") as HTMLElement | null;
  if (!target || !shell) return null;

  const targetRect = target.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  const sourceElement =
    trigger.querySelector<HTMLElement>(".market-sold-stamp") ?? trigger;
  const sourceRect = sourceElement.getBoundingClientRect();
  const manageGrid = trigger.closest(".market-grid-manage");
  const visibleCardBottoms = Array.from(
    manageGrid?.querySelectorAll<HTMLElement>(".market-listing-sold") ?? [],
  )
    .map((card) => card.getBoundingClientRect())
    .filter((rect) => rect.bottom > 0 && rect.top < window.innerHeight)
    .map((rect) => rect.bottom);

  const left = Math.max(
    shellRect.left + VIEWPORT_SIDE_GUTTER,
    VIEWPORT_SIDE_GUTTER,
  );
  const right = Math.min(
    shellRect.right - VIEWPORT_SIDE_GUTTER,
    window.innerWidth - VIEWPORT_SIDE_GUTTER,
  );
  const top = Math.max(targetRect.top - 4, 8);
  const lowestSoldCard = Math.max(sourceRect.bottom, ...visibleCardBottoms);
  const bottom = Math.min(
    lowestSoldCard,
    window.innerHeight * 0.66,
    window.innerHeight - VIEWPORT_BOTTOM_GUTTER,
  );
  if (right - left < 120 || bottom - top < 160) return null;

  const source = centerOf(sourceRect);
  const targetPoint = {
    x: targetRect.left + Math.min(20, targetRect.width * 0.24),
    y: targetRect.top + targetRect.height / 2,
  };
  const spread = SPREAD_POINTS.map(([x, y]) => ({
    x: left + (right - left) * x,
    y: top + (bottom - top) * y,
  }));

  return { id: saleSequence, source, target: targetPoint, spread };
}

function centerOf(rect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}
