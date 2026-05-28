import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildTonProofDigest,
  createTonProofHash,
  parseRawTonAddress,
  resolveExpectedTonProofDomain,
  verifyTonProof,
  type TonConnectAccount,
  type TonProofPayload,
} from "../../packages/server/src/ton/tonConnect";

const RAW_ADDRESS = `0:${"a".repeat(64)}`;
const DOMAIN = "example.app";
const PAYLOAD = "wallet-proof-test-challenge";
const TIMESTAMP = 1_779_954_000;
const NOW = new Date(TIMESTAMP * 1000);

describe("tonConnect proof utilities", () => {
  it("verifies a TON proof with a trusted Ed25519 public key", async () => {
    const fixture = createSignedProofFixture();

    await expect(
      verifyTonProof({
        account: fixture.account,
        proof: fixture.proof,
        expectedDomain: DOMAIN,
        expectedPayload: PAYLOAD,
        now: NOW,
        trustedPublicKey: fixture.publicKey,
      }),
    ).resolves.toMatchObject({
      verified: true,
      address: RAW_ADDRESS,
      network: "mainnet",
      domain: DOMAIN,
      payload: PAYLOAD,
      proofHash: createTonProofHash(fixture.account, fixture.proof),
      walletPublicKey: fixture.publicKey.toString("hex"),
    });
  });

  it("does not trust account.publicKey unless explicitly allowed", async () => {
    const fixture = createSignedProofFixture();

    await expect(
      verifyTonProof({
        account: {
          ...fixture.account,
          publicKey: fixture.publicKey.toString("hex"),
        },
        proof: fixture.proof,
        expectedDomain: DOMAIN,
        expectedPayload: PAYLOAD,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      code: "TON_PROOF_PUBLIC_KEY_UNRESOLVED",
    });
  });

  it("rejects a proof for a different domain", async () => {
    const fixture = createSignedProofFixture();

    await expect(
      verifyTonProof({
        account: fixture.account,
        proof: fixture.proof,
        expectedDomain: "other.example.app",
        expectedPayload: PAYLOAD,
        now: NOW,
        trustedPublicKey: fixture.publicKey,
      }),
    ).rejects.toMatchObject({
      code: "TON_PROOF_DOMAIN_MISMATCH",
    });
  });

  it("rejects expired proofs", async () => {
    const fixture = createSignedProofFixture();

    await expect(
      verifyTonProof({
        account: fixture.account,
        proof: fixture.proof,
        expectedDomain: DOMAIN,
        expectedPayload: PAYLOAD,
        now: new Date((TIMESTAMP + 301) * 1000),
        maxAgeSeconds: 300,
        trustedPublicKey: fixture.publicKey,
      }),
    ).rejects.toMatchObject({
      code: "TON_PROOF_EXPIRED",
    });
  });

  it("resolves the expected domain from app URLs", () => {
    expect(
      resolveExpectedTonProofDomain({
        PUBLIC_APP_URL: "https://Example.App/path",
      } as NodeJS.ProcessEnv),
    ).toBe("example.app");
  });
});

function createSignedProofFixture(): {
  account: TonConnectAccount;
  proof: TonProofPayload;
  publicKey: Buffer;
} {
  const keyPair = generateKeyPairSync("ed25519");
  const unsignedProof: TonProofPayload = {
    timestamp: TIMESTAMP,
    domain: {
      lengthBytes: Buffer.byteLength(DOMAIN, "utf8"),
      value: DOMAIN,
    },
    payload: PAYLOAD,
    signature: "",
  };
  const digest = buildTonProofDigest(
    parseRawTonAddress(RAW_ADDRESS),
    unsignedProof,
  );
  const signature = sign(null, digest, keyPair.privateKey);
  const proof = {
    ...unsignedProof,
    signature: signature.toString("base64"),
  };

  return {
    account: {
      address: RAW_ADDRESS,
      chain: "MAINNET",
    },
    proof,
    publicKey: exportRawEd25519PublicKey(keyPair.publicKey),
  };
}

function exportRawEd25519PublicKey(publicKey: {
  export(options: { format: "der"; type: "spki" }): Buffer;
}): Buffer {
  return publicKey.export({ format: "der", type: "spki" }).subarray(-32);
}
