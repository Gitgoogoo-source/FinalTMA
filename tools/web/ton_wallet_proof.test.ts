import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  buildTonProofDigest,
  parseRawTonAddress,
  verifyTonProof,
  type VerifyTonProofInput,
} from "../../apps/api/src/platform/ton/tonConnect.ts";
function signedInput(): VerifyTonProofInput {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  const address = `0:${"AB".repeat(32)}`;
  const domain = "final-tma-pi.vercel.app";
  const proof = {
    domain: { lengthBytes: Buffer.byteLength(domain), value: domain },
    payload: "test-server-nonce",
    timestamp: Math.floor(Date.now() / 1000),
    signature: "",
  };
  proof.signature = sign(
    null,
    buildTonProofDigest(parseRawTonAddress(address), proof),
    privateKey,
  ).toString("base64");
  return {
    account: { address, chain: "-239" },
    proof,
    expectedDomain: domain,
    expectedPayload: proof.payload,
    resolvePublicKey: async () => rawPublicKey,
  };
}
test("valid ownership signatures return a canonical address for the database unique key", async () => {
  const input = signedInput();
  const result = await verifyTonProof(input);
  assert.equal(result.address, input.account.address.toLowerCase());
  assert.equal(result.network, "mainnet");
});
for (const scenario of [
  "domain",
  "nonce",
  "expired",
  "tampered",
  "network",
] as const) {
  test(`reject ${scenario} proof`, async () => {
    const input = signedInput();
    if (scenario === "domain") input.expectedDomain = "attacker.example";
    if (scenario === "nonce") input.expectedPayload = "different-server-nonce";
    if (scenario === "expired") input.proof.timestamp -= 600;
    if (scenario === "tampered") input.account.address = `0:${"cd".repeat(32)}`;
    if (scenario === "network") input.account.chain = "-999";
    await assert.rejects(verifyTonProof(input));
  });
}
