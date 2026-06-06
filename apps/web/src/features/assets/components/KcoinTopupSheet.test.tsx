import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KcoinTopupSheet } from "./KcoinTopupSheet";

describe("KcoinTopupSheet", () => {
  it("shows a shortage topup option before fixed packages", () => {
    render(
      <KcoinTopupSheet
        open
        currentBalance={1}
        requiredAmount={10}
        activeOrder={null}
        statusSnapshot={null}
        invoiceNotice={null}
        pendingAmount={null}
        isCreating={false}
        isCheckingStatus={false}
        onSelectAmount={vi.fn()}
        onRetryPayment={vi.fn()}
        onCheckStatus={vi.fn()}
        onClearOrder={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("补足 9 K-coin")).toBeVisible();
    expect(screen.getByText("推荐，支付 9 Stars")).toBeVisible();
    expect(screen.getByText("500 K-coin")).toBeVisible();
    expect(screen.getByText("1,000 K-coin")).toBeVisible();
    expect(screen.getByText("5,000 K-coin")).toBeVisible();
    expect(screen.getByText("10,000 K-coin")).toBeVisible();
  });
});
