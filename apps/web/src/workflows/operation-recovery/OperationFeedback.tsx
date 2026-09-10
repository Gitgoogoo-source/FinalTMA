import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { tr } from "../../platform/i18n/index.ts";
import type { OperationPhase } from "./context.ts";
import "../../shared/styles/operation-feedback.css";

export function OperationFeedback({
  phase,
  title,
  message,
  onClose,
  onRecover,
  onCollection,
}: {
  phase: OperationPhase;
  title: string;
  message?: string | undefined;
  onClose(): void;
  onRecover(): void;
  onCollection?: (() => void) | undefined;
}): ReactNode {
  const target = useFeedbackTarget();
  const closeRef = useRef(onClose);
  const latestPhase = useRef(phase);
  useLayoutEffect(() => {
    latestPhase.current = phase;
  }, [phase]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const wasTerminal =
        latestPhase.current === "succeeded" || latestPhase.current === "failed";
      const close = closeRef.current;
      // StrictMode immediately replays setup; only a real unmount retires a
      // confirmed notice when another operation takes its place.
      queueMicrotask(() => {
        if (!mounted.current && wasTerminal) close();
      });
    };
  }, []);
  const terminal = phase === "succeeded" || phase === "failed";
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    // An unresolved operation must remain queryable and must never expire as a toast.
    if (phase !== "succeeded") return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible")
        timer = window.setTimeout(() => closeRef.current(), 4_500);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [phase]);
  if (!target) return null;
  return createPortal(
    <aside className={`app-shell operation-feedback-host phase-${phase}`}>
      <div className="operation-feedback-card">
        <span className="operation-feedback-icon" aria-hidden="true">
          {phase === "succeeded" ? (
            <Check />
          ) : phase === "failed" ? (
            <CircleAlert />
          ) : (
            <LoaderCircle />
          )}
        </span>
        <div
          className="operation-feedback-copy"
          role={phase === "failed" ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{title}</strong>
          {message ? <p>{message}</p> : null}
        </div>
        {terminal || phase === "pending" || phase === "unknown" ? (
          <button
            type="button"
            className="operation-feedback-close"
            onClick={onClose}
            aria-label={tr("Dismiss message", "收起提示")}
          >
            <X />
          </button>
        ) : null}
        {phase === "pending" || phase === "unknown" ? (
          <button
            type="button"
            className="operation-feedback-link"
            onClick={onRecover}
          >
            {tr("Check result", "查看结果")}
          </button>
        ) : phase === "succeeded" && onCollection ? (
          <button
            type="button"
            className="operation-feedback-link"
            onClick={onCollection}
          >
            {tr("View collection", "查看藏品")}
          </button>
        ) : null}
      </div>
    </aside>,
    target,
  );
}

function useFeedbackTarget(): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const locate = () =>
      setTarget(
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-modal-feedback-slot]",
          ),
        ].at(-1) ?? document.body,
      );
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return target;
}

export function OperationResume({
  label,
  onResume,
}: {
  label: string;
  onResume(): void;
}): ReactNode {
  const target = useFeedbackTarget();
  return target
    ? createPortal(
        <aside className="app-shell operation-feedback-host">
          <button className="operation-feedback-resume" onClick={onResume}>
            <CircleAlert aria-hidden="true" />
            {label}
          </button>
        </aside>,
        target,
      )
    : null;
}
