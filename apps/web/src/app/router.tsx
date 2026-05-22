import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";

import { BoxPage } from "@/features/box/pages/BoxPage";
import { CollectionPage } from "@/features/collection/pages/CollectionPage";
import { GamePage } from "@/features/game/pages/GamePage";
import { TasksPage } from "@/features/tasks/pages/TasksPage";
import { TradePage } from "@/features/trade/pages/TradePage";
import { APP_ROUTES } from "@/shared/constants/routes";

import { App } from "./App";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <RedirectToBox />,
      },
      {
        path: "box",
        element: <BoxPage />,
      },
      {
        path: "collection",
        element: <CollectionPage />,
      },
      {
        path: "trade",
        element: <TradePage />,
      },
      {
        path: "game",
        element: <GamePage />,
      },
      {
        path: "tasks",
        element: <TasksPage />,
      },
      {
        path: "*",
        element: <RedirectToBox />,
      },
    ],
  },
]);

function RedirectToBox() {
  const location = useLocation();

  return <Navigate replace to={`${APP_ROUTES.box}${location.search}`} />;
}
