import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AssetBar } from "@/features/assets/components/AssetBar";
import { resolveAppRoute } from "@/shared/constants/routes";

import { BottomNav } from "./BottomNav";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const routeKey = resolveAppRoute(location.pathname);
  const contentClassName =
    routeKey === "collection"
      ? "app-shell__content app-shell__content--locked-y"
      : "app-shell__content";

  return (
    <div className="app-shell">
      <AssetBar />
      <main className={contentClassName}>{children}</main>
      <BottomNav />
    </div>
  );
}
