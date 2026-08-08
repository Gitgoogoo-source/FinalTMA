import type { ComponentType } from "react";

import type { MainPagePath } from "../../shared/navigation/pageActivity.tsx";

export type PreloadablePagePath = MainPagePath | "/album";
type PageModule = { default: ComponentType };

const pageModuleImports: Record<
  PreloadablePagePath,
  () => Promise<PageModule>
> = {
  "/": () =>
    import("../../pages/gacha/GachaPage.tsx").then((module) => ({
      default: module.GachaPage,
    })),
  "/market": () =>
    import("../../pages/market/MarketPage.tsx").then((module) => ({
      default: module.MarketPage,
    })),
  "/game": () =>
    import("../../pages/game/GamePage.tsx").then((module) => ({
      default: module.GamePage,
    })),
  "/inventory": () =>
    import("../../pages/inventory/InventoryPage.tsx").then((module) => ({
      default: module.InventoryPage,
    })),
  "/tasks": () =>
    import("../../pages/tasks/TasksPage.tsx").then((module) => ({
      default: module.TasksPage,
    })),
  "/album": () =>
    import("../../pages/album/AlbumPage.tsx").then((module) => ({
      default: module.AlbumPage,
    })),
};

const pageModulePromises = new Map<PreloadablePagePath, Promise<PageModule>>();

export function loadPageModule(path: PreloadablePagePath): Promise<PageModule> {
  const existing = pageModulePromises.get(path);
  if (existing) return existing;
  const loading = pageModuleImports[path]().catch((error: unknown) => {
    if (pageModulePromises.get(path) === loading)
      pageModulePromises.delete(path);
    throw error;
  });
  pageModulePromises.set(path, loading);
  return loading;
}

export const loadGachaPage = () => loadPageModule("/");
export const loadMarketPage = () => loadPageModule("/market");
export const loadGamePage = () => loadPageModule("/game");
export const loadInventoryPage = () => loadPageModule("/inventory");
export const loadTasksPage = () => loadPageModule("/tasks");
export const loadAlbumPage = () => loadPageModule("/album");

export function preparePageModule(target: string): Promise<void> {
  const path = target.split(/[?#]/, 1)[0] ?? "";
  if (!isPreloadablePagePath(path)) return Promise.resolve();
  return loadPageModule(path).then(() => undefined);
}

function isPreloadablePagePath(path: string): path is PreloadablePagePath {
  return Object.prototype.hasOwnProperty.call(pageModuleImports, path);
}

export function getMainPagePath(pathname: string): MainPagePath | null {
  if (
    pathname === "/" ||
    pathname === "/market" ||
    pathname === "/game" ||
    pathname === "/inventory" ||
    pathname === "/tasks"
  )
    return pathname;
  return null;
}
