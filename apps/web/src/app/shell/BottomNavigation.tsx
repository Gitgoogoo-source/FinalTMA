import {
  Boxes,
  Gamepad2,
  ListChecks,
  PackageSearch,
  ShoppingBasket,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useOperationRegistry } from "../../workflows/operation-recovery/index.ts";

const navigation = [
  { path: "/market", label: "交易", icon: ShoppingBasket },
  { path: "/game", label: "游戏", icon: Gamepad2 },
  { path: "/", label: "开盒", icon: Boxes },
  { path: "/inventory", label: "藏品", icon: PackageSearch },
  { path: "/tasks", label: "任务", icon: ListChecks },
] as const;

export function BottomNavigation(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { navigationLocked } = useOperationRegistry();
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
        return (
          <button
            key={path}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            aria-label={`前往${label}`}
            aria-disabled={navigationLocked}
            disabled={navigationLocked}
            onClick={() => {
              if (!navigationLocked) navigate(path);
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
