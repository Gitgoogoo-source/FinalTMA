import type { ReactNode } from "react";

import { AssetBar } from "@/features/assets/components/AssetBar";

import { BottomNav } from "./BottomNav";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <AssetBar />
      <main className="app-shell__content">{children}</main>
      <BottomNav />
    </div>
  );
}
