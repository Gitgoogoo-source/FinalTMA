import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

const WALLET_ACCOUNT = {
  address: "0:abcdef0123456789",
  chain: "testnet",
  publicKey: "wallet-public-key",
  walletStateInit: "wallet-state-init",
};

const WALLET_PROOF = {
  timestamp: 1_779_954_000,
  domain: {
    lengthBytes: 15,
    value: "example.app",
  },
  payload: "challenge-payload",
  signature: "proof-signature",
};

describe("wallet api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("does not mark a proof response as verified without backend verified evidence", async () => {
    mocks.apiRequest.mockResolvedValueOnce({});

    const { verifyWalletProof } = await import("./wallet.api");
    const result = await verifyWalletProof({
      account: WALLET_ACCOUNT,
      proof: WALLET_PROOF,
      walletAppName: "Tonkeeper",
      challenge: "challenge-payload",
      idempotencyKey: "wallet:proof:test-key",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith("/wallet/proof", {
      method: "POST",
      body: {
        account: WALLET_ACCOUNT,
        proof: WALLET_PROOF,
        wallet_app_name: "Tonkeeper",
        challenge: "challenge-payload",
        idempotency_key: "wallet:proof:test-key",
      },
      headers: {
        "X-Idempotency-Key": "wallet:proof:test-key",
      },
    });
    expect(result).toMatchObject({
      status: "connected_unverified",
      address: WALLET_ACCOUNT.address,
      rawAddress: WALLET_ACCOUNT.address,
      network: WALLET_ACCOUNT.chain,
      walletAppName: "Tonkeeper",
      verifiedAt: null,
    });
  });

  it("uses backend wallet status to show a verified proof", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      status: "verified",
      verified: true,
      address: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
      raw_address: WALLET_ACCOUNT.address,
      network: "mainnet",
      wallet_app_name: "Tonkeeper",
      verified_at: "2026-05-28T10:00:00.000Z",
    });

    const { verifyWalletProof } = await import("./wallet.api");
    const result = await verifyWalletProof({
      account: WALLET_ACCOUNT,
      proof: WALLET_PROOF,
      walletAppName: "Tonkeeper",
      challenge: "challenge-payload",
      idempotencyKey: "wallet:proof:test-key",
    });

    expect(result).toMatchObject({
      status: "verified",
      address: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
      rawAddress: WALLET_ACCOUNT.address,
      network: "mainnet",
      walletAppName: "Tonkeeper",
      verifiedAt: "2026-05-28T10:00:00.000Z",
    });
  });

  it("creates a Mint request with a backend idempotency key", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      accepted: true,
      mint_queue_id: "77777777-7777-4777-8777-777777777777",
      status: "queued",
      item_instance_id: "44444444-4444-4444-8444-444444444444",
      metadata_url: "/nft-metadata/items/ember_whelp.json",
      idempotent: false,
    });

    const { createWalletMint } = await import("./wallet.api");
    const result = await createWalletMint({
      itemInstanceId: "44444444-4444-4444-8444-444444444444",
      targetAddress: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
      chain: "MAINNET",
      idempotencyKey: "wallet:mint:test-key",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith("/wallet/mint", {
      method: "POST",
      body: {
        item_instance_id: "44444444-4444-4444-8444-444444444444",
        target_address: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
        chain: "MAINNET",
        idempotency_key: "wallet:mint:test-key",
      },
      headers: {
        "X-Idempotency-Key": "wallet:mint:test-key",
      },
    });
    expect(result).toMatchObject({
      accepted: true,
      mintQueueId: "77777777-7777-4777-8777-777777777777",
      status: "queued",
      itemInstanceId: "44444444-4444-4444-8444-444444444444",
      metadataUrl: "/nft-metadata/items/ember_whelp.json",
      idempotent: false,
    });
  });

  it("normalizes Mint queue items and summary", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          mint_queue_id: "77777777-7777-4777-8777-777777777777",
          item_instance_id: "44444444-4444-4444-8444-444444444444",
          status: "confirming",
          chain: "MAINNET",
          collection_address: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
          target_address: "EQabcdefghijklmnopqrstuvwxyz1234567890ABCDE",
          transaction_hash: "tx_mint_001",
          retry_count: 1,
          created_at: "2026-05-29T08:00:00.000Z",
          updated_at: "2026-05-29T08:01:00.000Z",
        },
      ],
      summary: {
        queued: 1,
        processing: 0,
        submitted: 0,
        confirming: 1,
        retrying: 0,
        minted: 0,
        cancelled: 0,
        failed: 0,
        manual_review: 0,
      },
      next_cursor: "20",
      server_time: "2026-05-29T08:02:00.000Z",
    });

    const { fetchWalletMintQueue } = await import("./wallet.api");
    const result = await fetchWalletMintQueue();

    expect(mocks.apiRequest).toHaveBeenCalledWith("/wallet/mint-status", {
      method: "GET",
    });
    expect(result).toMatchObject({
      summary: {
        queued: 1,
        confirming: 1,
      },
      nextCursor: "20",
      items: [
        {
          mintQueueId: "77777777-7777-4777-8777-777777777777",
          itemInstanceId: "44444444-4444-4444-8444-444444444444",
          status: "confirming",
          transactionHash: "tx_mint_001",
          retryCount: 1,
        },
      ],
    });
  });
});
