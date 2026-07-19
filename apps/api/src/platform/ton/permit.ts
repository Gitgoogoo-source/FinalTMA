import { createHash } from "node:crypto";

import { Address, beginCell } from "@ton/core";
import { sign } from "@ton/crypto";

import { getTonEnv } from "../env/index.ts";

export const MINT_WITH_PERMIT_OPCODE = 0x504d494e;

export type MintPermit = {
  mint_id: string;
  nft_number: number;
  nonce: string;
  receiver: string;
  template_id: string;
  expires_at: string;
};

export type SignedMintPermit = {
  digest: string;
  signature: string;
  transaction: {
    valid_until: number;
    messages: Array<{ address: string; amount: string; payload: string }>;
  };
};

export function signMintPermit(permit: MintPermit): SignedMintPermit {
  const env = getTonEnv();
  const receiver = Address.parse(permit.receiver);
  const templateHash = createHash("sha256")
    .update(permit.template_id, "utf8")
    .digest();
  const nonce = uuidBytes(permit.nonce);
  const expiresAt = Math.floor(new Date(permit.expires_at).getTime() / 1000);
  if (
    !Number.isSafeInteger(permit.nft_number) ||
    permit.nft_number < 0 ||
    !Number.isSafeInteger(expiresAt)
  )
    throw new Error("MINT_PERMIT_INVALID:Mint 凭证数值无效");
  const metadataUri = `${env.NFT_METADATA_BASE_URL.replace(/\/$/, "")}/${permit.nft_number}`;
  const metadataCell = beginCell().storeStringTail(metadataUri).endCell();
  const unsigned = beginCell()
    .storeAddress(Address.parse(env.TON_COLLECTION_ADDRESS))
    .storeAddress(receiver)
    .storeUint(permit.nft_number, 64)
    .storeBuffer(templateHash)
    .storeBuffer(nonce)
    .storeUint(expiresAt, 64)
    .storeRef(metadataCell)
    .endCell();
  const privateKey = Buffer.from(env.TON_MINT_AUTH_PRIVATE_KEY, "base64");
  if (privateKey.length !== 64)
    throw new Error("TON_MINT_KEY_INVALID:Mint 签名密钥格式无效");
  const signature = Buffer.from(sign(unsigned.hash(), privateKey));
  const body = beginCell()
    .storeUint(MINT_WITH_PERMIT_OPCODE, 32)
    .storeAddress(receiver)
    .storeUint(permit.nft_number, 64)
    .storeBuffer(templateHash)
    .storeBuffer(nonce)
    .storeUint(expiresAt, 64)
    .storeRef(metadataCell)
    .storeRef(beginCell().storeBuffer(signature).endCell())
    .endCell();
  return {
    digest: unsigned.hash().toString("hex"),
    signature: signature.toString("base64"),
    transaction: {
      valid_until: expiresAt,
      messages: [
        {
          address: env.TON_COLLECTION_ADDRESS,
          amount: env.TON_MINT_VALUE_NANO,
          payload: body.toBoc().toString("base64"),
        },
      ],
    },
  };
}

function uuidBytes(value: string): Buffer {
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex))
    throw new Error("MINT_NONCE_INVALID:Mint nonce 无效");
  return Buffer.from(hex, "hex");
}
