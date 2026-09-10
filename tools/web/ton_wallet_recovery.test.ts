import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_WALLET_KEY,
  savePendingWalletConnection,
  readPendingWalletConnection,
  clearPendingWalletConnection,
  walletVerificationInput,
} from "../../apps/web/src/domains/wallet/pending-connection.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  },
});
const now = Date.now();
const pending = {
  userId: "player-a",
  payload: "server-challenge",
  expiresAt: now + 60_000,
};
const wallet = {
  account: {
    address: `0:${"ab".repeat(32)}`,
    chain: "-239",
    walletStateInit: "state-init",
  },
  device: { appName: "test-wallet" },
  connectItems: {
    tonProof: {
      name: "ton_proof",
      proof: {
        payload: pending.payload,
        timestamp: Math.floor(now / 1000),
        domain: { lengthBytes: 11, value: "app.example" },
        signature: "signed-by-wallet",
      },
    },
  },
} as Parameters<typeof walletVerificationInput>[0];

test("reload recovers only an unexpired challenge belonging to the current account", () => {
  savePendingWalletConnection(pending);
  assert.deepEqual(readPendingWalletConnection("player-a", now), pending);
  assert.equal(readPendingWalletConnection(undefined, now), null);
  assert.deepEqual(
    readPendingWalletConnection("player-a", now),
    pending,
    "auth startup must not erase pending work",
  );
  assert.equal(readPendingWalletConnection("player-b", now), null);
  assert.equal(values.has(PENDING_WALLET_KEY), false);
  savePendingWalletConnection(pending);
  assert.equal(
    readPendingWalletConnection("player-a", pending.expiresAt),
    null,
  );
});

test("cancel or completion cannot clear a newer connection", () => {
  const newer = { ...pending, payload: "new-challenge" };
  savePendingWalletConnection(newer);
  clearPendingWalletConnection(pending);
  assert.deepEqual(readPendingWalletConnection(pending.userId, now), newer);
  clearPendingWalletConnection(newer);
  assert.equal(readPendingWalletConnection(pending.userId, now), null);
});

test("corrupt storage is ignored", () => {
  values.set(PENDING_WALLET_KEY, "not-json");
  assert.equal(readPendingWalletConnection(pending.userId, now), null);
});

test("restored proof is mapped to the same server verification request", () => {
  const input = walletVerificationInput(wallet, pending, pending.userId, now);
  assert.equal(input.proof.payload, pending.payload);
  assert.equal(input.proof.domain.length_bytes, 11);
  assert.equal(input.account.wallet_state_init, "state-init");
});

for (const scenario of [
  "wrong user",
  "wrong nonce",
  "expired",
  "missing proof",
] as const) {
  test(`recovery rejects ${scenario}`, () => {
    const returned = structuredClone(wallet);
    if (scenario === "wrong nonce")
      returned.connectItems!.tonProof = {
        name: "ton_proof",
        proof: {
          ...wallet.connectItems!.tonProof!.proof,
          payload: "foreign-challenge",
        },
      };
    if (scenario === "missing proof") delete returned.connectItems;
    assert.throws(() =>
      walletVerificationInput(
        returned,
        pending,
        scenario === "wrong user" ? "player-b" : pending.userId,
        scenario === "expired" ? pending.expiresAt : now,
      ),
    );
  });
}
