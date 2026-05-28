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
});
