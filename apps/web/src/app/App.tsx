import { BoxPage } from "@/features/box/pages/BoxPage";
import { AppShell } from "@/shared/layout/AppShell";

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
  return (
    <AppShell>
      <BoxPage />
    </AppShell>
  );
}
