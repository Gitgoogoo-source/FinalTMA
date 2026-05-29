import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

describe("collection api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("requests onchain status for inventory detail so Mint state is server-backed", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      item_instance_id: "66666666-6666-4666-8666-666666666666",
      template_id: "55555555-5555-4555-8555-555555555555",
      name: "森林幼芽",
      status: "available",
      nft_mint_status: "queued",
      is_mintable: true,
      onchain_status: {
        is_minted: false,
        mint_status: "queued",
      },
    });

    const { fetchInventoryDetail } = await import("./collection.api");
    const result = await fetchInventoryDetail(
      "66666666-6666-4666-8666-666666666666",
    );
    const [url, requestOptions] = mocks.apiRequest.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(url).split("?")[1] ?? "");

    expect(String(url).startsWith("/inventory/detail?")).toBe(true);
    expect(params.get("item_instance_id")).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(params.get("include_market_status")).toBe("true");
    expect(params.get("include_upgrade_preview")).toBe("true");
    expect(params.get("include_evolution_preview")).toBe("true");
    expect(params.get("include_decompose_preview")).toBe("true");
    expect(params.get("include_onchain_status")).toBe("true");
    expect(requestOptions).toMatchObject({
      method: "GET",
    });
    expect(result.onchainStatus).toMatchObject({
      isMinted: false,
      mintStatus: "queued",
    });
  });
});
