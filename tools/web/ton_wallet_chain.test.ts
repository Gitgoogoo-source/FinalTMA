import assert from "node:assert/strict";
import test from "node:test";
import {
  getTonEnv,
  getTonWalletEnv,
} from "../../apps/api/src/platform/env/index.ts";
import { resolveTonWalletPublicKeyFromChain } from "../../apps/api/src/platform/ton/chainClient.ts";

test("wallet public-key lookup requires only wallet chain configuration, while Mint stays strict", async () => {
  const keys = [
    "TON_NETWORK",
    "TON_API_BASE_URL",
    "TON_API_KEY",
    "APP_BASE_URL",
    "TON_COLLECTION_ADDRESS",
    "TON_MINT_VALUE_NANO",
    "TON_MINT_AUTH_PRIVATE_KEY",
    "NFT_METADATA_BASE_URL",
  ];
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  try {
    keys.forEach((key) => {
      delete process.env[key];
    });
    assert.throws(
      () => getTonWalletEnv(),
      "wallet network and endpoint must still be required",
    );
    Object.assign(process.env, {
      TON_NETWORK: "mainnet",
      TON_API_BASE_URL: "https://toncenter.example/api/v2",
    });
    let queries = 0;
    globalThis.fetch = async (url, options) => {
      queries++;
      assert.equal(url, "https://toncenter.example/api/v2/runGetMethod");
      assert.equal(new Headers(options!.headers).has("x-api-key"), false);
      assert.equal(
        JSON.parse(options!.body as string).method,
        "get_public_key",
      );
      return new Response(
        JSON.stringify({ ok: true, result: { stack: [["num", "0x01"]] } }),
      );
    };
    const key = await resolveTonWalletPublicKeyFromChain({
      address: `0:${"ab".repeat(32)}`,
      chain: "-239",
    });
    assert.equal(key, "1".padStart(64, "0"));
    assert.equal(queries, 1);
    assert.throws(
      () => getTonEnv(),
      "Mint must still require its private key and collection settings",
    );
    assert.equal(
      await resolveTonWalletPublicKeyFromChain({
        address: `0:${"ab".repeat(32)}`,
        chain: "-3",
      }),
      null,
    );
    assert.equal(
      queries,
      1,
      "a different network must not query the configured chain",
    );
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
