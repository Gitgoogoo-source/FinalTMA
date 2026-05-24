import {
  BookOpen,
  Box as BoxIcon,
  ClipboardList,
  Gamepad2,
  Images,
  Store,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { MAIN_NAV_ITEMS, type MainNavItem } from "@/shared/constants/nav";
import { APP_ROUTES } from "@/shared/constants/routes";

const NAV_ICONS = {
  trade: Store,
  game: Gamepad2,
  box: BoxIcon,
  collection: Images,
  album: BookOpen,
  tasks: ClipboardList,
} as const;

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {MAIN_NAV_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.key];
        const isActive = isNavItemActive(item, location.pathname);

        return (
          <Link
            className={`bottom-nav__item${
              isActive ? " bottom-nav__item--active" : ""
            }`}
            key={item.key}
            to={item.path}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={2.4} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function isNavItemActive(item: MainNavItem, pathname: string): boolean {
  if (item.path === APP_ROUTES.box) {
    return pathname === "/" || pathname.startsWith(APP_ROUTES.box);
  }

  return pathname.startsWith(item.path);
}
