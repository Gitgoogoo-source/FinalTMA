import type { ReactNode } from "react";

import { AlbumView } from "../../domains/album/index.ts";
import "../../shared/styles/album-page.css";

export function AlbumPage(): ReactNode {
  return <AlbumView />;
}
