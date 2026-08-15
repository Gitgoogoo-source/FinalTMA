import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app-client";

import { selectionHaptic } from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/Button.tsx";
import {
  CatalogImage,
  type CatalogImageStatus,
} from "../../shared/ui/CatalogImage.tsx";
import {
  validatePublicPetUrl,
  type CatalogImageVariant,
} from "../../shared/ui/catalogImageUrl.ts";
import { GachaAstralBackdrop } from "./GachaAstralBackdrop.tsx";
import { localized, t, tp } from "../../platform/i18n/index.ts";

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
const rarityLabels: Record<Rarity, string> = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
});
const raritySigilCounts: Record<Rarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};
const tenDrawRankPositions = [4, 5, 3, 6, 2, 7, 1, 8, 0, 9] as const;
const initialCarouselIndex = tenDrawRankPositions[0];
const initialRevealedLayerOrder = 0;
const carouselLayerOffsets = [0, 0.24, 0.34, 0.42, 0.48, 0.53] as const;
const carouselLayerScales = [1, 0.52, 0.43, 0.36, 0.3, 0.26] as const;
const carouselLayerOpacities = [1, 0.82, 0.62, 0.44, 0.3, 0.2] as const;

export function GachaResultImagePreloader({
  result,
}: {
  result: GachaResult;
}): null {
  useEffect(() => {
    const rankedResults = [...result.results].sort(
      (left, right) =>
        rarityRanks[right.rarity] - rarityRanks[left.rarity] ||
        left.order - right.order,
    );
    const variant: CatalogImageVariant =
      result.draw_count === 1 ? "detail" : "thumbnail";
    const targets =
      result.draw_count === 1 ? rankedResults.slice(0, 1) : rankedResults;
    const images: HTMLImageElement[] = [];

    targets.forEach((item, index) => {
      const requestedUrl =
        variant === "detail" ? item.image_detail_url : item.image_thumbnail_url;
      const validUrl = validatePublicPetUrl(requestedUrl, variant);
      if (!validUrl) return;
      const image = new Image();
      image.decoding = "async";
      image.loading = "eager";
      image.fetchPriority = index === 0 ? "high" : "auto";
      image.src = validUrl;
      images.push(image);
      void image.decode().catch(() => undefined);
    });

    return () => images.forEach((image) => image.removeAttribute("src"));
  }, [result]);

  return null;
}

function resultImageKey(item: ResultItem): string {
  return `${item.order}-${item.template_id}`;
}

function layerRevealOrder(index: number): number {
  const order = tenDrawRankPositions.indexOf(
    index as (typeof tenDrawRankPositions)[number],
  );
  return order === -1 ? index : order;
}

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
  operationId,
  result,
  busy,
  error,
  visible,
  retryEpoch,
  onImageStatusChange,
  onRepeat,
  onInventory,
  onConfirm,
}: {
  operationId: string;
  result: GachaResult;
  busy: boolean;
  error: string | null;
  visible: boolean;
  retryEpoch: number;
  onImageStatusChange(operationId: string, status: CatalogImageStatus): void;
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
  const highestRarity = rankedResults[0]?.rarity ?? "common";
  const imageKeys = rankedResults.map(resultImageKey);
  const preparationKey = `${single ? "single" : "ten"}:${imageKeys.join("|")}:${retryEpoch}`;
  const [preparation, setPreparation] = useState<{
    key: string;
    statuses: Record<string, CatalogImageStatus>;
  }>({ key: "", statuses: {} });
  const statuses =
    preparation.key === preparationKey ? preparation.statuses : {};
  const revealImageKeys = single ? imageKeys : imageKeys.slice(0, 1);
  const imageStatus: CatalogImageStatus = revealImageKeys.every(
    (key) => statuses[key] === "ready",
  )
    ? "ready"
    : revealImageKeys.some((key) => statuses[key] === "failed")
      ? "failed"
      : "loading";

  useEffect(() => {
    onImageStatusChange(operationId, imageStatus);
  }, [imageStatus, onImageStatusChange, operationId]);

  const updateImageStatus = (imageKey: string, status: CatalogImageStatus) => {
    setPreparation((current) => {
      const currentStatuses =
        current.key === preparationKey ? current.statuses : {};
      if (
        currentStatuses[imageKey] === status &&
        current.key === preparationKey
      )
        return current;
      return {
        key: preparationKey,
        statuses: { ...currentStatuses, [imageKey]: status },
      };
    });
  };

  return (
    <div
      className={`modal gacha-astral-result ${single ? "is-single" : "is-ten"} rarity-${highestRarity}${visible ? "" : " is-preparing"}`}
      aria-hidden={!visible}
      inert={!visible}
    >
      <GachaAstralBackdrop calm />
      <header className="gacha-astral-heading">
        <small>{single ? t("灵契降临") : t("群星共鸣")}</small>
        <h2 id="gacha-result-title">{t("召唤结果")}</h2>
      </header>

      {single ? (
        <SingleResult
          item={rankedResults[0]!}
          imageKey={imageKeys[0]!}
          retryEpoch={retryEpoch}
          onImageStatusChange={updateImageStatus}
        />
      ) : (
        <TenDrawResults
          results={rankedResults}
          imageStatuses={statuses}
          visible={visible}
          retryEpoch={retryEpoch}
          onImageStatusChange={updateImageStatus}
        />
      )}

      {error ? <p className="operation-ack-error">{error}</p> : null}
      <div className="gacha-astral-actions">
        <Button disabled={busy} onClick={onRepeat}>
          {busy ? t("请稍候") : t("再开一次")}
        </Button>
        <Button className="secondary" disabled={busy} onClick={onInventory}>
          {t("去藏品查看")}
        </Button>
        <Button className="secondary" disabled={busy} onClick={onConfirm}>
          {t("确定")}
        </Button>
      </div>
    </div>
  );
}

function SingleResult({
  item,
  imageKey,
  retryEpoch,
  onImageStatusChange,
}: {
  item: ResultItem;
  imageKey: string;
  retryEpoch: number;
  onImageStatusChange(imageKey: string, status: CatalogImageStatus): void;
}): ReactNode {
  return (
    <article className={`gacha-astral-single rarity-${item.rarity}`}>
      <ResultIdentity item={item} />
      <div className="gacha-astral-art">
        <span className="gacha-astral-aura" aria-hidden="true" />
        <span className="gacha-astral-pedestal" aria-hidden="true" />
        <CatalogImage
          key={`${imageKey}:${retryEpoch}`}
          url={item.image_detail_url}
          alt={t(item.name)}
          variant="detail"
          loading="eager"
          fetchPriority="high"
          onStatusChange={(status) => onImageStatusChange(imageKey, status)}
        />
        <span className="gacha-astral-new">NEW</span>
      </div>
    </article>
  );
}

function TenDrawResults({
  results,
  imageStatuses,
  visible,
  retryEpoch,
  onImageStatusChange,
}: {
  results: ResultItem[];
  imageStatuses: Record<string, CatalogImageStatus>;
  visible: boolean;
  retryEpoch: number;
  onImageStatusChange(imageKey: string, status: CatalogImageStatus): void;
}): ReactNode {
  const carouselResults: ResultItem[] = [];
  results.forEach((item, rank) => {
    carouselResults[tenDrawRankPositions[rank] ?? rank] = item;
  });

  const carouselRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLOListElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number>(initialCarouselIndex);
  const [revealedLayerOrder, setRevealedLayerOrder] = useState(
    initialRevealedLayerOrder,
  );
  const resultKey = carouselResults.map(resultImageKey).join("|");
  const maximumLayerOrder = Math.max(0, carouselResults.length - 1);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let frameId: number | null = null;
    let order = initialRevealedLayerOrder;
    const revealNextLayer = () => {
      if (cancelled || order >= maximumLayerOrder) return;
      order += 1;
      setRevealedLayerOrder(order);
      if (order < maximumLayerOrder)
        frameId = window.requestAnimationFrame(revealNextLayer);
    };
    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(revealNextLayer);
    });

    return () => {
      cancelled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [maximumLayerOrder, resultKey, visible]);

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
    <section className="gacha-astral-ten" aria-label={t("十连召唤结果")}>
      <ol ref={layerListRef} className="gacha-astral-layer-list">
        {carouselResults.map((item, index) => {
          const imageKey = resultImageKey(item);
          const layerDistance = Math.abs(index - initialCarouselIndex);
          const revealOrder = layerRevealOrder(index);
          const imageReady = imageStatuses[imageKey] === "ready";
          const stageVisible = imageReady && revealOrder <= revealedLayerOrder;
          return (
            <li
              key={imageKey}
              className={`rarity-${item.rarity}${imageReady ? " is-stage-prepared" : ""}${stageVisible ? " is-stage-visible" : ""}`}
              style={
                {
                  "--carousel-left": `${
                    50 +
                    Math.sign(index - initialCarouselIndex) *
                      interpolateCarouselLayer(
                        layerDistance,
                        carouselLayerOffsets,
                      ) *
                      100
                  }%`,
                  "--carousel-scale": interpolateCarouselLayer(
                    layerDistance,
                    carouselLayerScales,
                  ),
                  "--carousel-opacity": interpolateCarouselLayer(
                    layerDistance,
                    carouselLayerOpacities,
                  ),
                  zIndex: 100 - layerDistance * 10,
                } as CSSProperties
              }
              aria-label={tp("{{0}}藏品：{{1}}，NEW", [
                rarityLabels[item.rarity],
                t(item.name),
              ])}
              aria-current={index === initialCarouselIndex ? "true" : undefined}
              aria-posinset={index + 1}
              aria-setsize={carouselResults.length}
            >
              <ResultIdentity item={item} />
              <span className="gacha-astral-new">NEW</span>
              <div className="gacha-astral-art">
                <span className="gacha-astral-aura" aria-hidden="true" />
                <span className="gacha-astral-pedestal" aria-hidden="true" />
                <CatalogImage
                  key={`${imageKey}:${retryEpoch}`}
                  url={item.image_thumbnail_url}
                  alt={t(item.name)}
                  variant="thumbnail"
                  loading="eager"
                  fetchPriority={
                    index === initialCarouselIndex ? "high" : "auto"
                  }
                  onStatusChange={(status) =>
                    onImageStatusChange(imageKey, status)
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div
        ref={carouselRef}
        className="gacha-astral-carousel"
        role="group"
        aria-label={t("十连召唤结果，左右滑动查看")}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={scheduleCarouselUpdate}
      >
        {carouselResults.map((item) => (
          <span
            key={`${item.order}-${item.template_id}`}
            className="gacha-astral-snap-point"
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}

function ResultIdentity({ item }: { item: ResultItem }): ReactNode {
  return (
    <div className="gacha-astral-identity">
      <strong className="gacha-astral-rarity">
        {rarityLabels[item.rarity]}
      </strong>
      <span
        className="gacha-astral-sigils"
        aria-label={tp("{{0}} 枚稀有度星印", [raritySigilCounts[item.rarity]])}
      >
        {Array.from({ length: raritySigilCounts[item.rarity] }, (_, index) => (
          <i key={index} aria-hidden="true" />
        ))}
      </span>
      <h3>{t(item.name)}</h3>
    </div>
  );
}
