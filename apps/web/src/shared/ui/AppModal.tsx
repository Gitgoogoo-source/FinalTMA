import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type BackgroundState = {
  count: number;
  inert: boolean;
  modalOpen: boolean;
};

const backgroundStates = new WeakMap<HTMLElement, BackgroundState>();
const activeDialogs = new Set<HTMLElement>();
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

export function AppModal({
  children,
  labelledBy,
  label,
  className = "",
  onClose,
}: {
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  className?: string;
  onClose?: (() => void) | undefined;
}): ReactNode {
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background = document.querySelector<HTMLElement>(
      "[data-app-shell-background]",
    );
    if (background) retainBackground(background);
    retainScrollLock();

    const current = dialog.current;
    if (current) activeDialogs.add(current);
    const initial =
      current?.querySelector<HTMLElement>("[autofocus]") ??
      focusableElements(current)[0] ??
      current;
    initial?.focus({ preventScroll: true });

    return () => {
      if (current) activeDialogs.delete(current);
      if (background) releaseBackground(background);
      releaseScrollLock();
      queueMicrotask(() => {
        if (
          activeDialogs.size === 0 &&
          trigger?.isConnected &&
          !trigger.closest("[inert]")
        )
          trigger.focus({ preventScroll: true });
      });
    };
  }, []);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current?.();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableElements(event.currentTarget);
    if (controls.length === 0) {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      return;
    }
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === event.currentTarget)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!event.currentTarget.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={dialog}
      className={`app-shell modal-backdrop app-modal-backdrop ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      onKeyDown={trapFocus}
    >
      {children}
    </div>,
    document.body,
  );
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.closest("[inert]"),
      )
    : [];
}

function retainBackground(background: HTMLElement): void {
  const state = backgroundStates.get(background);
  if (state) {
    state.count += 1;
    return;
  }
  backgroundStates.set(background, {
    count: 1,
    inert: background.inert,
    modalOpen: background.hasAttribute("data-app-modal-open"),
  });
  background.inert = true;
  background.setAttribute("data-app-modal-open", "");
}

function releaseBackground(background: HTMLElement): void {
  const state = backgroundStates.get(background);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;
  background.inert = state.inert;
  if (!state.modalOpen) background.removeAttribute("data-app-modal-open");
  backgroundStates.delete(background);
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
