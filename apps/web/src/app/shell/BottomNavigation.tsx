import {
  Boxes,
  Gamepad2,
  ListChecks,
  PackageSearch,
  ShoppingBasket,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const navigation = [
  { path: "/market", label: "交易", icon: ShoppingBasket },
  { path: "/game", label: "游戏", icon: Gamepad2 },
  { path: "/", label: "开盒", icon: Boxes },
  { path: "/inventory", label: "藏品", icon: PackageSearch },
  { path: "/tasks", label: "任务", icon: ListChecks },
];

export function BottomNavigation(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav">
      {navigation.map(({ path, label, icon: Icon }) => (
        <button
          key={path}
          className={
            (
              path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(path)
            )
              ? "active"
              : ""
          }
          onClick={() => navigate(path)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
