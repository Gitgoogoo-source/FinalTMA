import type { MainPagePath } from "../../shared/navigation/pageActivity.tsx";

export const loadGachaPage = () =>
  import("../../pages/gacha/GachaPage.tsx").then((module) => ({
    default: module.GachaPage,
  }));
export const loadMarketPage = () =>
  import("../../pages/market/MarketPage.tsx").then((module) => ({
    default: module.MarketPage,
  }));
export const loadGamePage = () =>
  import("../../pages/game/GamePage.tsx").then((module) => ({
    default: module.GamePage,
  }));
export const loadInventoryPage = () =>
  import("../../pages/inventory/InventoryPage.tsx").then((module) => ({
    default: module.InventoryPage,
  }));
export const loadTasksPage = () =>
  import("../../pages/tasks/TasksPage.tsx").then((module) => ({
    default: module.TasksPage,
  }));

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
