import { APP_ROUTES, type AppRouteKey, type AppRoutePath } from "./routes";

export type MainNavRouteKey = Exclude<AppRouteKey, "album">;

export type MainNavItem = {
  key: MainNavRouteKey;
  label: string;
  path: AppRoutePath;
};

export const MAIN_NAV_ITEMS: MainNavItem[] = [
  {
    key: "trade",
    label: "交易",
    path: APP_ROUTES.trade,
  },
  {
    key: "game",
    label: "游戏",
    path: APP_ROUTES.game,
  },
  {
    key: "box",
    label: "开盒",
    path: APP_ROUTES.box,
  },
  {
    key: "collection",
    label: "藏品",
    path: APP_ROUTES.collection,
  },
  {
    key: "tasks",
    label: "任务",
    path: APP_ROUTES.tasks,
  },
];
