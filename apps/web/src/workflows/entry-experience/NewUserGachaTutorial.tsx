import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  useAppLocation,
  useAppNavigate,
} from "../../platform/navigation/index.tsx";
import { useApiQuery } from "../../platform/query/index.ts";
import { Button } from "../../shared/ui/Button.tsx";
import {
  useOperationNavigationLocked,
  useOperationRecoveryQueueActive,
} from "../operation-recovery/context.ts";
import { t } from "../../platform/i18n/index.ts";
import { hasConsumedSeededEntitlement } from "./new-user-gacha-tutorial-state.ts";

import "./new-user-gacha-tutorial.css";

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function NewUserGachaTutorial({
  entryNotice,
  onNoticePresented,
  onPersistCompletion,
  onSettled,
}: {
  entryNotice: string | null;
  onNoticePresented(): void;
  onPersistCompletion(): void;
  onSettled(status: "completed" | "dismissed", noticePresented: boolean): void;
}): ReactNode {
  const location = useAppLocation();
  const navigate = useAppNavigate();
  const boxes = useApiQuery("gacha.bootstrap");
  const navigationLocked = useOperationNavigationLocked();
  const recoveryQueueActive = useOperationRecoveryQueueActive();
  const [phase, setPhase] = useState<"guiding" | "opening">("guiding");
  const [confirmedFreeOpen, setConfirmedFreeOpen] = useState(false);
  const baselineFreeCount = useRef<number | null>(null);
  const noticePresented = useRef(false);
  const settled = useRef(false);
  const freeCount = boxes.data?.entitlements.free_normal_box;
  const rulesReady = boxes.data?.rules_complete === true;
  const finish = useCallback(
    (status: "completed" | "dismissed") => {
      if (settled.current) return;
      settled.current = true;
      onSettled(status, noticePresented.current);
    },
    [onSettled],
  );
  const persistCompletion = useCallback(() => {
    onPersistCompletion();
  }, [onPersistCompletion]);
  const presentNotice = useCallback(() => {
    if (noticePresented.current) return;
    noticePresented.current = true;
    onNoticePresented();
  }, [onNoticePresented]);

  useEffect(() => {
    const resolved = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail) {
        persistCompletion();
        setConfirmedFreeOpen(true);
        return;
      }
      setConfirmedFreeOpen(false);
      setPhase("guiding");
    };
    window.addEventListener("evomypet:gacha-open", resolved);
    return () => window.removeEventListener("evomypet:gacha-open", resolved);
  }, [persistCompletion]);

  useEffect(() => {
    if (navigationLocked || recoveryQueueActive || boxes.isFetching) return;
    if (
      freeCount !== undefined &&
      hasConsumedSeededEntitlement(
        confirmedFreeOpen,
        baselineFreeCount.current,
        freeCount,
      )
    ) {
      persistCompletion();
      finish("completed");
    }
  }, [
    boxes.isFetching,
    confirmedFreeOpen,
    finish,
    freeCount,
    navigationLocked,
    persistCompletion,
    recoveryQueueActive,
  ]);

  useEffect(() => {
    if (
      phase !== "guiding" ||
      navigationLocked ||
      recoveryQueueActive ||
      location.pathname !== "/" ||
      !rulesReady ||
      freeCount === undefined ||
      freeCount <= 0
    )
      return;
    const params = new URLSearchParams(location.search);
    if (params.has("resume")) return;
    if (
      params.get("tier") === "normal" &&
      !params.has("rarity") &&
      !params.has("focus")
    )
      return;
    params.set("tier", "normal");
    params.delete("rarity");
    params.delete("focus");
    navigate(
      { pathname: "/", search: `?${params.toString()}` },
      { replace: true },
    );
  }, [
    freeCount,
    location.pathname,
    location.search,
    navigate,
    navigationLocked,
    phase,
    recoveryQueueActive,
    rulesReady,
  ]);

  const selector =
    location.pathname === "/"
      ? ".gacha-actions button.single-draw"
      : isMainPage(location.pathname)
        ? '.bottom-nav button[data-app-nav-path="/"]'
        : null;
  const target = useTutorialTarget(
    selector,
    phase === "guiding" &&
      rulesReady &&
      Boolean(freeCount && freeCount > 0) &&
      !navigationLocked &&
      !recoveryQueueActive,
  );
  const rect = useTargetRect(target);
  const targetVisible = rect !== null;
  const drawStep = location.pathname === "/";

  useEffect(() => {
    if (!target || !targetVisible) return;
    presentNotice();
    const previousDescription = target.getAttribute("aria-describedby");
    target.classList.add("new-user-tutorial-target");
    target.setAttribute(
      "aria-describedby",
      [previousDescription, "new-user-gacha-tutorial-copy"]
        .filter(Boolean)
        .join(" "),
    );
    target.focus({ preventScroll: true });
    return () => {
      target.classList.remove("new-user-tutorial-target");
      if (previousDescription)
        target.setAttribute("aria-describedby", previousDescription);
      else target.removeAttribute("aria-describedby");
    };
  }, [presentNotice, target, targetVisible]);

  useEffect(() => {
    if (!target || !drawStep) return;
    const bounds = target.getBoundingClientRect();
    if (bounds.top >= 72 && bounds.bottom <= window.innerHeight - 82) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }, [drawStep, target]);

  useEffect(() => {
    if (!target || !drawStep || freeCount === undefined) return;
    const start = () => {
      baselineFreeCount.current = freeCount;
      setConfirmedFreeOpen(false);
      setPhase("opening");
    };
    target.addEventListener("click", start, { capture: true });
    return () => target.removeEventListener("click", start, { capture: true });
  }, [drawStep, freeCount, target]);

  useEffect(() => {
    const skip = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish("dismissed");
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [finish]);

  if (
    (boxes.error || (boxes.data && !rulesReady)) &&
    !navigationLocked &&
    !recoveryQueueActive
  )
    return (
      <TutorialUnavailable
        entryNotice={entryNotice}
        onPresented={presentNotice}
        onRetry={() => void boxes.refetch()}
        onSkip={() => finish("dismissed")}
        retrying={boxes.isFetching}
      />
    );
  if (!target || !rect || phase !== "guiding") return null;
  const style = {
    "--tutorial-target-top": `${rect.top}px`,
    "--tutorial-target-left": `${rect.left}px`,
    "--tutorial-target-width": `${rect.width}px`,
    "--tutorial-target-height": `${rect.height}px`,
  } as CSSProperties;
  return (
    <div className="new-user-tutorial-layer" style={style}>
      <span className="new-user-tutorial-ring" aria-hidden="true" />
      <section
        className="new-user-tutorial-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="new-user-gacha-tutorial-title"
        aria-describedby="new-user-gacha-tutorial-copy"
      >
        <small>{t("新手引导")}</small>
        <strong id="new-user-gacha-tutorial-title">
          {drawStep ? t("开启你的第一只伙伴") : t("免费普通盲盒已到账")}
        </strong>
        <p id="new-user-gacha-tutorial-copy">
          {drawStep
            ? t("点击“开 1 次”，本次免费，不会消耗 Stars。")
            : t("点击底部“开盒”，去开启你的第一只伙伴。")}
        </p>
        {entryNotice ? (
          <p className="new-user-tutorial-entry-notice">{entryNotice}</p>
        ) : null}
        <button
          type="button"
          className="new-user-tutorial-skip"
          onClick={() => finish("dismissed")}
        >
          {t("跳过引导")}
        </button>
      </section>
    </div>
  );
}

function TutorialUnavailable({
  entryNotice,
  onPresented,
  onRetry,
  onSkip,
  retrying,
}: {
  entryNotice: string | null;
  onPresented(): void;
  onRetry(): void;
  onSkip(): void;
  retrying: boolean;
}): ReactNode {
  useEffect(onPresented, [onPresented]);
  return (
    <section
      className="new-user-tutorial-unavailable"
      role="dialog"
      aria-modal="false"
      aria-labelledby="new-user-tutorial-unavailable-title"
    >
      <strong id="new-user-tutorial-unavailable-title">
        {t("免费盲盒暂时未准备好")}
      </strong>
      <p>{t("重新尝试，或跳过引导后继续冒险。")}</p>
      {entryNotice ? (
        <p className="new-user-tutorial-entry-notice">{entryNotice}</p>
      ) : null}
      <div>
        <Button disabled={retrying} onClick={onRetry}>
          {retrying ? t("正在准备冒险") : t("重新尝试")}
        </Button>
        <Button className="secondary" onClick={onSkip}>
          {t("跳过引导")}
        </Button>
      </div>
    </section>
  );
}

function useTutorialTarget(
  selector: string | null,
  enabled: boolean,
): HTMLButtonElement | null {
  const [target, setTarget] = useState<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !selector) return;
    const locate = () => {
      const next = document.querySelector<HTMLButtonElement>(selector);
      setTarget(next && !next.disabled ? next : null);
    };
    const frame = window.requestAnimationFrame(locate);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, selector]);
  return enabled && selector && target?.matches(selector) ? target : null;
}

function useTargetRect(target: HTMLElement | null): TargetRect | null {
  const [measurement, setMeasurement] = useState<{
    target: HTMLElement;
    rect: TargetRect | null;
  } | null>(null);
  useLayoutEffect(() => {
    if (!target) return;
    const update = () => {
      const next = target.getBoundingClientRect();
      if (next.width <= 0 || next.height <= 0) {
        setMeasurement({ target, rect: null });
        return;
      }
      setMeasurement({
        target,
        rect: {
          top: next.top,
          left: next.left,
          width: next.width,
          height: next.height,
        },
      });
    };
    const resizeObserver = new ResizeObserver(update);
    const scrollRoot = document.querySelector<HTMLElement>("[data-app-scroll]");
    resizeObserver.observe(target);
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    scrollRoot?.addEventListener("scroll", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      scrollRoot?.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [target]);
  return measurement?.target === target ? measurement.rect : null;
}

function isMainPage(pathname: string): boolean {
  return ["/", "/market", "/game", "/inventory", "/tasks"].includes(pathname);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
