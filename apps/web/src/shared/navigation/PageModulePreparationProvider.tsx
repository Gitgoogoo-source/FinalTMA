import type { ReactNode } from "react";

import {
  PageModulePreparationContext,
  type PreparePageModule,
} from "./pageModulePreparation.ts";

export function PageModulePreparationProvider({
  prepare,
  children,
}: {
  prepare: PreparePageModule;
  children: ReactNode;
}): ReactNode {
  return (
    <PageModulePreparationContext.Provider value={prepare}>
      {children}
    </PageModulePreparationContext.Provider>
  );
}
