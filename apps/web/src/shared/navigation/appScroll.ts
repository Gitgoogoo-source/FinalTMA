const appScrollSelector = "[data-app-scroll]";

export function getAppScrollTop(): number {
  return appScrollContainer()?.scrollTop ?? Math.max(0, window.scrollY);
}

export function getAppMaxScrollTop(): number {
  const container = appScrollContainer();
  return container
    ? Math.max(0, container.scrollHeight - container.clientHeight)
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

export function scrollAppTo(top: number): void {
  const options = { top, left: 0, behavior: "auto" as const };
  const container = appScrollContainer();
  if (container) container.scrollTo(options);
  else window.scrollTo(options);
}

function appScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(appScrollSelector);
}
