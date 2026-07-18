import { Address } from "@ton/core";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4 } from "@ton/ton";

import { PokePetsNftCollection } from "../build/PokePetsNftCollection_PokePetsNftCollection.ts";

const network = process.argv[2];
if (network !== "testnet" && network !== "mainnet")
  throw new Error("Usage: deploy.ts <testnet|mainnet>");
if (
  network === "mainnet" &&
  required("TON_MAINNET_DEPLOY_APPROVED") !== "I_UNDERSTAND_MAINNET"
)
  throw new Error("Mainnet deployment has not been explicitly approved.");
if (required("TON_NETWORK") !== network)
  throw new Error("TON_NETWORK does not match the deployment target.");

const keyPair = await mnemonicToPrivateKey(
  required("TON_DEPLOYER_MNEMONIC").trim().split(/\s+/),
);
const client = new TonClient({
  endpoint: required("TON_RPC_ENDPOINT"),
  ...(process.env.TON_RPC_API_KEY
    ? { apiKey: process.env.TON_RPC_API_KEY }
    : {}),
});
const wallet = client.open(
  WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }),
);
if (!(await client.isContractDeployed(wallet.address)))
  throw new Error("Deployment wallet is not active on the selected network.");
const owner = Address.parse(required("TON_COLLECTION_OWNER_ADDRESS"));
if (!wallet.address.equals(owner))
  throw new Error(
    "TON_COLLECTION_OWNER_ADDRESS must equal the deployment wallet address.",
  );
const royaltyDestination = Address.parse(required("TON_ROYALTY_DESTINATION"));
const mintPublicKey = BigInt(`0x${required("TON_MINT_AUTH_PUBLIC_KEY_HEX")}`);
const collection = client.open(
  await PokePetsNftCollection.fromInit(
    owner,
    mintPublicKey,
    royaltyDestination,
    required("TON_COLLECTION_METADATA_URL"),
  ),
);
if (await client.isContractDeployed(collection.address))
  throw new Error(
    `Collection is already deployed at ${collection.address.toString()}.`,
  );
const seqno = await wallet.getSeqno();
await collection.send(
  wallet.sender(keyPair.secretKey),
  { value: BigInt(required("TON_COLLECTION_DEPLOY_VALUE_NANO")) },
  "deploy",
);
await waitForSeqno(wallet, seqno);
if (!(await client.isContractDeployed(collection.address)))
  throw new Error("Collection deployment transaction was not confirmed.");
process.stdout.write(
  `${JSON.stringify({ network, collection_address: collection.address.toString(), owner: owner.toString(), royalty_destination: royaltyDestination.toString(), royalty: "1%" })}\n`,
);

async function waitForSeqno(
  openedWallet: typeof wallet,
  previous: number,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if ((await openedWallet.getSeqno()) > previous) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for the deployment transaction.");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
