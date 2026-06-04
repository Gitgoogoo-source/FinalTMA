import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TradePage } from "./TradePage";

vi.mock("./BuyPage", () => ({
  BuyPage: () => <div data-testid="buy-panel">购买面板</div>,
}));

vi.mock("./SellPage", () => ({
  SellPage: () => <div data-testid="sell-panel">出售面板</div>,
}));

vi.mock("./ManageListingsPage", () => ({
  ManageListingsPage: () => <div data-testid="manage-panel">管理面板</div>,
}));

describe("TradePage", () => {
  it("renders the buy, sell and manage tabs with buy as the default tab", () => {
    render(
      <MemoryRouter initialEntries={["/trade"]}>
        <TradePage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("heading", { name: "交易市场" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Telegram Mini App")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "购买" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "出售" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "报价 / 管理" })).toBeVisible();
    expect(screen.getByTestId("buy-panel")).toBeVisible();
  });

  it("switches to the manage tab without relying on market write state", () => {
    render(
      <MemoryRouter initialEntries={["/trade?tab=sell"]}>
        <TradePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sell-panel")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "报价 / 管理" }));

    expect(screen.getByRole("tab", { name: "报价 / 管理" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("manage-panel")).toBeVisible();
  });
});
