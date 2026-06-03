import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SellInventoryFilters } from "./SellInventoryFilters";
import type {
  SellInventoryFilterKey,
  SellInventoryFiltersState,
} from "../hooks/useSellInventoryFilters";

const DEFAULT_FILTERS: SellInventoryFiltersState = {
  minPriceKcoin: "",
  maxPriceKcoin: "",
  rarity: "",
  typeCode: "",
  sort: "recently_obtained",
};

describe("SellInventoryFilters", () => {
  it("renders the sell inventory filter bar below the selected item area", () => {
    renderFilters();

    expect(screen.getByLabelText("出售页筛选")).toBeVisible();
    expect(screen.getByRole("button", { name: /Price/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Rarity/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Type/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "重置出售筛选" }),
    ).toBeDisabled();
  });

  it("passes rarity and price changes back to the sellable item query state", () => {
    const onFilterChange = vi.fn();

    renderFilters({ onFilterChange });

    fireEvent.click(screen.getByRole("button", { name: /Rarity/ }));
    fireEvent.click(screen.getByRole("option", { name: "史诗" }));

    expect(onFilterChange).toHaveBeenCalledWith("rarity", "epic");

    fireEvent.click(screen.getByRole("button", { name: /Price/ }));
    fireEvent.change(screen.getByLabelText("最低参考价"), {
      target: { value: "120" },
    });

    expect(onFilterChange).toHaveBeenCalledWith("minPriceKcoin", "120");
  });

  it("resets active filters with the all chip", () => {
    const onReset = vi.fn();

    renderFilters({
      filters: {
        ...DEFAULT_FILTERS,
        rarity: "rare",
      },
      hasActiveFilters: true,
      onReset,
    });

    fireEvent.click(screen.getByRole("button", { name: "重置出售筛选" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function renderFilters({
  filters = DEFAULT_FILTERS,
  hasActiveFilters = false,
  onFilterChange = vi.fn(),
  onReset = vi.fn(),
}: {
  filters?: SellInventoryFiltersState;
  hasActiveFilters?: boolean;
  onFilterChange?: <Key extends SellInventoryFilterKey>(
    key: Key,
    value: SellInventoryFiltersState[Key],
  ) => void;
  onReset?: () => void;
} = {}) {
  return render(
    <SellInventoryFilters
      filters={filters}
      hasActiveFilters={hasActiveFilters}
      onFilterChange={onFilterChange}
      onReset={onReset}
    />,
  );
}
