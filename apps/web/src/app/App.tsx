import { BoxPage } from "@/features/box/pages/BoxPage";
import { CollectionPage } from "@/features/collection/pages/CollectionPage";
import { APP_ROUTES, resolveAppRoute } from "@/shared/constants/routes";
import { AppShell } from "@/shared/layout/AppShell";
import { Link, useLocation } from "react-router-dom";

import { RequireSession } from "./guards/RequireSession";
import { AppProviders } from "./providers/AppProviders";

export function App() {
  return (
    <AppProviders>
      <RequireSession>
        <AuthenticatedHome />
      </RequireSession>
    </AppProviders>
  );
}

function AuthenticatedHome() {
  const location = useLocation();
  const route = resolveAppRoute(location.pathname);

  return (
    <AppShell>
      {route === "box" ? <BoxPage /> : null}
      {route === "collection" ? <CollectionPage /> : null}
      {route === "trade" ? <PlaceholderPage title="交易功能后续开放" /> : null}
      {route === "game" ? <PlaceholderPage title="游戏功能后续开放" /> : null}
      {route === "tasks" ? <PlaceholderPage title="任务功能后续开放" /> : null}
    </AppShell>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="placeholder-page">
      <strong>{title}</strong>
      <Link to={APP_ROUTES.box}>返回开盒</Link>
    </section>
  );
}
