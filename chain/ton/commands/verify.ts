import { Address, beginCell } from "@ton/core";
import { TonClient } from "@ton/ton";

import { PokePetsNftCollection } from "../build/PokePetsNftCollection_PokePetsNftCollection.ts";

const endpoint = required("TON_RPC_ENDPOINT");
const address = Address.parse(required("TON_COLLECTION_ADDRESS"));
const client = new TonClient({
  endpoint,
  ...(process.env.TON_RPC_API_KEY
    ? { apiKey: process.env.TON_RPC_API_KEY }
    : {}),
});
if (!(await client.isContractDeployed(address)))
  throw new Error("Collection contract is not deployed.");
const collection = client.open(PokePetsNftCollection.fromAddress(address));
const data = await collection.getGetCollectionData();
const royalty = await collection.getRoyaltyParams();
const mintPublicKey = await collection.getMintPublicKey();
const expectedOwner = Address.parse(required("TON_COLLECTION_OWNER_ADDRESS"));
const expectedRoyaltyDestination = Address.parse(
  required("TON_ROYALTY_DESTINATION"),
);
const expectedPublicKey = BigInt(
  `0x${required("TON_MINT_AUTH_PUBLIC_KEY_HEX")}`,
);
const expectedContent = beginCell()
  .storeUint(1, 8)
  .storeStringTail(required("TON_COLLECTION_METADATA_URL"))
  .endCell();
if (!data.ownerAddress.equals(expectedOwner))
  throw new Error("On-chain owner does not match the release configuration.");
if (royalty.numerator !== 1n || royalty.denominator !== 100n)
  throw new Error("On-chain royalty is not 1%.");
if (!royalty.destination.equals(expectedRoyaltyDestination))
  throw new Error(
    "On-chain royalty destination does not match the release configuration.",
  );
if (mintPublicKey !== expectedPublicKey)
  throw new Error(
    "On-chain permit public key does not match the release configuration.",
  );
if (!data.collectionContent.hash().equals(expectedContent.hash()))
  throw new Error(
    "On-chain collection content does not match the immutable metadata URI.",
  );
process.stdout.write(
  `${JSON.stringify({ collection_address: address.toString(), owner: data.ownerAddress.toString(), minted_count: data.nextItemIndex.toString(), mint_public_key: mintPublicKey.toString(16), collection_content_hash: data.collectionContent.hash().toString("hex"), royalty_numerator: royalty.numerator.toString(), royalty_denominator: royalty.denominator.toString(), royalty_destination: royalty.destination.toString() })}\n`,
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
