import { X } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../platform/i18n/index.ts";

type InertState = { count: number; initial: boolean };

const inertStates = new WeakMap<HTMLElement, InertState>();
const activePanels = new Set<HTMLElement>();
let scrollLocks = 0;
let rootOverflow = "";
let bodyOverflow = "";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function BattleModal({
  labelledBy,
  panelClassName,
  backgroundRef,
  dismissible,
  closeLabel,
  onClose,
  children,
}: {
  labelledBy: string;
  panelClassName: string;
  backgroundRef: RefObject<HTMLElement | null>;
  dismissible: boolean;
  closeLabel?: string;
  onClose?: () => void;
  children: ReactNode;
}): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background = backgroundRef.current;
    if (background) retainInert(background);
    retainScrollLock();

    const panel = panelRef.current;
    if (panel) activePanels.add(panel);
    const initial =
      panel?.querySelector<HTMLElement>("[data-battle-initial-focus]") ??
      focusableElements(panel)[0] ??
      panel;
    initial?.focus({ preventScroll: true });

    return () => {
      if (panel) activePanels.delete(panel);
      if (background) releaseInert(background);
      releaseScrollLock();
      queueMicrotask(() => {
        if (
          (!panel || !activePanels.has(panel)) &&
          trigger?.isConnected &&
          !trigger.closest("[inert]")
        )
          trigger.focus({ preventScroll: true });
      });
    };
  }, [backgroundRef]);

  const close = () => {
    if (dismissible) onCloseRef.current?.();
  };

  return createPortal(
    <div
      className="game-page battle-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (dismissible) close();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = focusableElements(panelRef.current);
          if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current?.focus({ preventScroll: true });
            return;
          }
          const first = focusable[0]!;
          const last = focusable.at(-1)!;
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === panelRef.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === panelRef.current)
          ) {
            event.preventDefault();
            first.focus();
          } else if (!panelRef.current?.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {dismissible ? (
          <button
            type="button"
            className="battle-sheet-close"
            aria-label={closeLabel ?? t("关闭弹层")}
            onClick={close}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[inert]"),
  );
}

function retainInert(element: HTMLElement): void {
  const current = inertStates.get(element);
  if (current) {
    current.count += 1;
    return;
  }
  inertStates.set(element, { count: 1, initial: element.inert });
  element.inert = true;
}

function releaseInert(element: HTMLElement): void {
  const current = inertStates.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;
  element.inert = current.initial;
  inertStates.delete(element);
}

function retainScrollLock(): void {
  if (scrollLocks === 0) {
    rootOverflow = document.documentElement.style.overflow;
    bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
}

function releaseScrollLock(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  document.documentElement.style.overflow = rootOverflow;
  document.body.style.overflow = bodyOverflow;
}
