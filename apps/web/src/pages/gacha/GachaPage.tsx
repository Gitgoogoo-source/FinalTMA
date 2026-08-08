import type { ReactNode } from "react";

import { GachaView } from "../../domains/gacha/index.ts";
import "../../shared/styles/gacha-page.css";

export function GachaPage(): ReactNode {
  return <GachaView />;
}
