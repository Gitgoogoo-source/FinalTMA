import {
  Boxes,
  Gamepad2,
  ListChecks,
  PackageSearch,
  ShoppingBasket,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  useAppLocation,
  useAppNavigate,
} from "../../platform/navigation/index.tsx";
import { usePageModulePreparation } from "../../shared/navigation/pageModulePreparation.ts";
import { useOperationNavigationLocked } from "../../workflows/operation-recovery/context.ts";

const navigation = [
  { path: "/market", label: "交易", icon: ShoppingBasket },
  { path: "/game", label: "游戏", icon: Gamepad2 },
  { path: "/", label: "开盒", icon: Boxes },
  { path: "/inventory", label: "藏品", icon: PackageSearch },
  { path: "/tasks", label: "任务", icon: ListChecks },
] as const;

export function BottomNavigation(): ReactNode {
  const location = useAppLocation();
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  const navigationLocked = useOperationNavigationLocked();
  return (
    <nav
      className="bottom-nav"
      aria-label="主导航"
      data-locked={navigationLocked}
    >
      {navigation.map(({ path, label, icon: Icon }) => {
        const active =
          path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(path);
        const prepare = () => {
          if (!active && !navigationLocked) preparePage(path);
        };
        return (
          <button
            key={path}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            aria-label={`前往${label}`}
            aria-disabled={navigationLocked}
            disabled={navigationLocked}
            onPointerEnter={prepare}
            onPointerDown={prepare}
            onFocus={prepare}
            onClick={() => {
              if (!navigationLocked) {
                prepare();
                navigate(path);
              }
            }}
          >
            <span className="nav-icon">
              <Icon />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
