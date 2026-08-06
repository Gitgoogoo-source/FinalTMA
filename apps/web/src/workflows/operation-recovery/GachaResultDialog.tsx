import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { haptic, selectionHaptic } from "../../platform/telegram/index.ts";
import { Button, CatalogImage } from "../../shared/ui/index.tsx";
import { playGachaSummarySound } from "./gacha-audio.ts";

type GachaResult = RouteOutput<"gacha.open">;
type ResultItem = GachaResult["results"][number];
type Rarity = ResultItem["rarity"];

const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const initialCarouselIndex = 4;
const carouselLayerOffsets = [0, 0.24, 0.34, 0.42, 0.48, 0.53] as const;
const carouselLayerScales = [1, 0.52, 0.43, 0.36, 0.3, 0.26] as const;
const carouselLayerOpacities = [1, 0.82, 0.62, 0.44, 0.3, 0.2] as const;
const RITUAL_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-garden-b1291c69.webp";

function interpolateCarouselLayer(
  distance: number,
  values: readonly number[],
): number {
  const boundedDistance = Math.min(distance, values.length - 1);
  const lowerIndex = Math.floor(boundedDistance);
  const upperIndex = Math.min(lowerIndex + 1, values.length - 1);
  const progress = boundedDistance - lowerIndex;
  return (
    values[lowerIndex]! + (values[upperIndex]! - values[lowerIndex]!) * progress
  );
}

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
  const orderedResults = [...result.results].sort(
    (left, right) => left.order - right.order,
  );
  const single = result.draw_count === 1;
  const resultKey = orderedResults
    .map((item) => `${item.order}-${item.template_id}`)
    .join("|");

  useEffect(() => {
    playGachaSummarySound();
    haptic("success");
  }, [resultKey]);

  return (
    <div
      className={`modal gacha-moon-result is-entering ${single ? "is-single" : "is-ten"}`}
    >
      <img
        className="gacha-moon-result-background"
        src={RITUAL_BACKGROUND}
        alt=""
        aria-hidden="true"
      />
      <header className="gacha-moon-heading">
        <small>{single ? "灵契已成" : "十连灵契"}</small>
        <h2 id="gacha-result-title">召唤结果</h2>
      </header>

      {single ? (
        <SingleResult item={orderedResults[0]!} />
      ) : (
        <TenDrawResults results={orderedResults} />
      )}

      {error ? <p className="operation-ack-error">{error}</p> : null}
      <div className="gacha-moon-actions">
        <Button disabled={busy} onClick={onRepeat}>
          {busy ? "请稍候" : "再开一次"}
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
    <article className={`gacha-moon-single rarity-${item.rarity}`}>
      <strong className="gacha-moon-rarity">{rarityLabels[item.rarity]}</strong>
      <div className="gacha-moon-art">
        <CatalogImage
          path={item.image_detail_path}
          alt={item.name}
          variant="detail"
          loading="eager"
          fetchPriority="high"
        />
        <span className="gacha-moon-new">NEW</span>
      </div>
    </article>
  );
}

function TenDrawResults({ results }: { results: ResultItem[] }): ReactNode {
  const carouselResults = results;

  const carouselRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLOListElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number>(initialCarouselIndex);
  const resultKey = carouselResults
    .map((item) => `${item.order}-${item.template_id}`)
    .join("|");

  const updateCarousel = useCallback((withHaptic: boolean) => {
    const carousel = carouselRef.current;
    const layerList = layerListRef.current;
    if (!carousel || !layerList) return;
    const anchors = Array.from(carousel.children) as HTMLElement[];
    const layers = Array.from(layerList.children) as HTMLElement[];
    const carouselCenter =
      carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    anchors.forEach((anchor, index) => {
      const layer = layers[index];
      if (!layer) return;
      const bounds = anchor.getBoundingClientRect();
      const signedDistance =
        (bounds.left + bounds.width / 2 - carouselCenter) /
        Math.max(anchor.offsetWidth, 1);
      const distance = Math.abs(signedDistance);
      const direction = Math.sign(signedDistance);
      const offset = interpolateCarouselLayer(distance, carouselLayerOffsets);
      layer.style.setProperty(
        "--carousel-left",
        `${50 + direction * offset * 100}%`,
      );
      layer.style.setProperty(
        "--carousel-scale",
        interpolateCarouselLayer(distance, carouselLayerScales).toFixed(3),
      );
      layer.style.setProperty(
        "--carousel-opacity",
        interpolateCarouselLayer(distance, carouselLayerOpacities).toFixed(3),
      );
      layer.style.zIndex = String(100 - Math.round(distance * 10));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    layers.forEach((layer, index) => {
      if (index === nearestIndex) layer.setAttribute("aria-current", "true");
      else layer.removeAttribute("aria-current");
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    <section className="gacha-moon-ten" aria-label="十连召唤结果">
      <ol ref={layerListRef} className="gacha-moon-layer-list">
        {carouselResults.map((item, index) => (
          <li
            key={`${item.order}-${item.template_id}`}
            className={`rarity-${item.rarity}`}
            style={
              {
                "--carousel-left": `${
                  50 +
                  Math.sign(index - initialCarouselIndex) *
                    interpolateCarouselLayer(
                      Math.abs(index - initialCarouselIndex),
                      carouselLayerOffsets,
                    ) *
                    100
                }%`,
                "--carousel-scale": interpolateCarouselLayer(
                  Math.abs(index - initialCarouselIndex),
                  carouselLayerScales,
                ),
                "--carousel-opacity": interpolateCarouselLayer(
                  Math.abs(index - initialCarouselIndex),
                  carouselLayerOpacities,
                ),
                "--summary-delay": `${45 + index * 34}ms`,
                zIndex: 100 - Math.abs(index - initialCarouselIndex) * 10,
              } as CSSProperties
            }
            aria-label={`${rarityLabels[item.rarity]}藏品：${item.name}，NEW`}
            aria-current={index === initialCarouselIndex ? "true" : undefined}
            aria-posinset={index + 1}
            aria-setsize={carouselResults.length}
          >
            <strong className="gacha-moon-rarity">
              {rarityLabels[item.rarity]}
            </strong>
            <span className="gacha-moon-new">NEW</span>
            <div className="gacha-moon-art">
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
      <div
        ref={carouselRef}
        className="gacha-moon-carousel"
        role="group"
        aria-label="十连召唤结果，左右滑动查看"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={scheduleCarouselUpdate}
      >
        {carouselResults.map((item) => (
          <span
            key={`${item.order}-${item.template_id}`}
            className="gacha-moon-snap-point"
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}
