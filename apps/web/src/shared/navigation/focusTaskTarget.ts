const focusableSelector =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function focusTaskTarget(target: HTMLElement | null): () => void {
  if (!target) return () => undefined;
  let timeout = 0;
  const frame = window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("task-navigation-focus");
    const focusable = target.matches(focusableSelector)
      ? target
      : target.querySelector<HTMLElement>(focusableSelector);
    (focusable ?? target).focus({ preventScroll: true });
    timeout = window.setTimeout(
      () => target.classList.remove("task-navigation-focus"),
      1_600,
    );
  });
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timeout);
    target.classList.remove("task-navigation-focus");
  };
}
