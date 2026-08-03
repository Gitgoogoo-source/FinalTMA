import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { selectionHaptic } from "../../platform/telegram/index.ts";
import { Button, CatalogImage } from "../../shared/ui/index.tsx";

type GachaResult = RouteOutput<"gacha.open">;
type ResultItem = GachaResult["results"][number];
type Rarity = ResultItem["rarity"];

const rarityRanks: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};
const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const tenDrawRankPositions = [4, 5, 3, 6, 2, 7, 1, 8, 0, 9] as const;
const initialCarouselIndex = tenDrawRankPositions[0];

export function GachaResultDialog({
  result,
  busy,
  error,
  onRepeat,
  onInventory,
  onConfirm,
}: {
  result: GachaResult;
  busy: boolean;
  error: string | null;
  onRepeat(): void;
  onInventory(): void;
  onConfirm(): void;
}): ReactNode {
  const rankedResults = [...result.results].sort(
    (left, right) =>
      rarityRanks[right.rarity] - rarityRanks[left.rarity] ||
      left.order - right.order,
  );
  const single = result.draw_count === 1;

  return (
    <div
      className={`modal gacha-result-modal ${single ? "is-single" : "is-ten"}`}
    >
      <header className="gacha-result-heading">
        <small>PIXEL PARTY</small>
        <h2 id="gacha-result-title">{single ? "召唤结果" : "十连召唤"}</h2>
      </header>

      {single ? (
        <SingleResult item={rankedResults[0]!} />
      ) : (
        <TenDrawResults results={rankedResults} />
      )}

      {error ? <p className="operation-ack-error">{error}</p> : null}
      <div className="gacha-result-actions">
        <Button disabled={busy} onClick={onRepeat}>
          {busy ? "正在确认结果" : "再开一次"}
        </Button>
        <Button className="secondary" disabled={busy} onClick={onInventory}>
          去藏品查看
        </Button>
        <Button className="secondary" disabled={busy} onClick={onConfirm}>
          确定
        </Button>
      </div>
    </div>
  );
}

function SingleResult({ item }: { item: ResultItem }): ReactNode {
  return (
    <article className={`gacha-single-result rarity-${item.rarity}`}>
      <strong className="gacha-result-rarity">
        {rarityLabels[item.rarity]}
      </strong>
      <div className="gacha-result-art">
        <CatalogImage
          path={item.image_detail_path}
          alt={item.name}
          variant="detail"
          loading="eager"
          fetchPriority="high"
        />
        <span className="new-indicator">NEW</span>
      </div>
    </article>
  );
}

function TenDrawResults({ results }: { results: ResultItem[] }): ReactNode {
  const carouselResults: ResultItem[] = [];
  results.forEach((item, rank) => {
    carouselResults[tenDrawRankPositions[rank] ?? rank] = item;
  });

  const carouselRef = useRef<HTMLOListElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number>(initialCarouselIndex);
  const resultKey = carouselResults
    .map((item) => `${item.order}-${item.template_id}`)
    .join("|");

  const updateCarousel = useCallback((withHaptic: boolean) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const items = Array.from(carousel.children) as HTMLElement[];
    const carouselCenter =
      carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    items.forEach((item, index) => {
      const bounds = item.getBoundingClientRect();
      const distance = Math.abs(
        bounds.left + bounds.width / 2 - carouselCenter,
      );
      const normalizedDistance = distance / Math.max(item.offsetWidth, 1);
      item.style.setProperty(
        "--carousel-scale",
        Math.max(0.56, 1 - normalizedDistance * 0.28).toFixed(3),
      );
      item.style.zIndex = String(100 - Math.round(normalizedDistance * 10));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    items.forEach((item, index) => {
      if (index === nearestIndex) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
    if (nearestIndex === activeIndexRef.current) return;
    activeIndexRef.current = nearestIndex;
    if (withHaptic) selectionHaptic();
  }, []);

  const scheduleCarouselUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateCarousel(true);
    });
  }, [updateCarousel]);

  const centerItem = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      const carousel = carouselRef.current;
      const item = carousel?.children.item(index) as HTMLElement | null;
      if (!carousel || !item) return;
      carousel.scrollTo({
        left: item.offsetLeft - (carousel.clientWidth - item.offsetWidth) / 2,
        behavior,
      });
    },
    [],
  );

  useLayoutEffect(() => {
    activeIndexRef.current = initialCarouselIndex;
    centerItem(initialCarouselIndex);
    updateCarousel(false);
    const carousel = carouselRef.current;
    if (!carousel) return;
    const resizeObserver = new ResizeObserver(() => {
      centerItem(activeIndexRef.current);
      updateCarousel(false);
    });
    resizeObserver.observe(carousel);
    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current !== null)
        cancelAnimationFrame(animationFrameRef.current);
    };
  }, [centerItem, resultKey, updateCarousel]);

  const handleKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    centerItem(
      Math.max(
        0,
        Math.min(
          carouselResults.length - 1,
          activeIndexRef.current + (event.key === "ArrowRight" ? 1 : -1),
        ),
      ),
      matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    );
  };

  return (
    <section className="gacha-ten-result" aria-label="十连召唤结果">
      <ol
        ref={carouselRef}
        className="gacha-result-carousel"
        aria-label="十连召唤结果，左右滑动查看"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={scheduleCarouselUpdate}
      >
        {carouselResults.map((item, index) => (
          <li
            key={`${item.order}-${item.template_id}`}
            className={`rarity-${item.rarity}`}
            style={
              {
                "--carousel-scale":
                  index === initialCarouselIndex
                    ? 1
                    : Math.max(
                        0.56,
                        1 - Math.abs(index - initialCarouselIndex) * 0.28,
                      ),
              } as CSSProperties
            }
            aria-label={`${rarityLabels[item.rarity]}藏品：${item.name}，NEW`}
            aria-current={index === initialCarouselIndex ? "true" : undefined}
            aria-posinset={index + 1}
            aria-setsize={carouselResults.length}
          >
            <strong className="gacha-result-rarity">
              {rarityLabels[item.rarity]}
            </strong>
            <span className="new-indicator">NEW</span>
            <div className="gacha-result-art">
              <CatalogImage
                path={item.image_detail_path}
                alt={item.name}
                variant="detail"
                loading={
                  Math.abs(index - initialCarouselIndex) <= 1 ? "eager" : "lazy"
                }
                fetchPriority={index === initialCarouselIndex ? "high" : "auto"}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
