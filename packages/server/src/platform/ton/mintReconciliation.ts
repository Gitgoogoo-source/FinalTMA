import { Address } from "@ton/core";
import { TonClient } from "@ton/ton";

import { rpc } from "../db/index.ts";
import { getEnv } from "../env/index.ts";

type Candidate = {
  mint_id: string;
  operation_id: string;
  nft_number: number;
  template_id: string;
  transaction_hash: string;
  submitted_at: string;
  receiver: string;
  name: string;
  rarity: string;
  stage: number;
  combat_power: number;
  image_path: string;
};

export async function reconcileSubmittedMints(): Promise<
  Record<string, number>
> {
  const env = getEnv();
  const client = new TonClient({
    endpoint: env.TON_API_BASE_URL,
    apiKey: env.TON_API_KEY,
  });
  const candidates = await rpc<Candidate[]>(
    "list_mint_reconciliation_candidates",
    { p_limit: 100 },
  );
  let succeeded = 0;
  let failed = 0;
  let unknown = 0;
  for (const candidate of candidates) {
    try {
      const result = await client.runMethod(
        Address.parse(env.TON_COLLECTION_ADDRESS),
        "get_nft_address_by_index",
        [{ type: "int", value: BigInt(candidate.nft_number) }],
      );
      const nftAddress = result.stack.readAddress();
      if (!(await client.isContractDeployed(nftAddress))) {
        if (
          Date.now() - new Date(candidate.submitted_at).getTime() <=
          30 * 60 * 1000
        ) {
          unknown += 1;
          continue;
        }
        await rpc("complete_mint", {
          p_mint_id: candidate.mint_id,
          p_success: false,
          p_nft_address: null,
          p_metadata_uri: null,
          p_metadata: null,
        });
        failed += 1;
        continue;
      }
      const metadataUri = `${env.NFT_METADATA_BASE_URL.replace(/\/$/, "")}/${candidate.nft_number}`;
      const metadata = {
        name: candidate.name,
        description: `PokePets ${candidate.name}`,
        image: new URL(candidate.image_path, env.APP_BASE_URL).toString(),
        attributes: [
          { trait_type: "Template", value: candidate.template_id },
          { trait_type: "Rarity", value: candidate.rarity },
          { trait_type: "Stage", value: candidate.stage },
          { trait_type: "Combat Power", value: candidate.combat_power },
        ],
      };
      await rpc("complete_mint", {
        p_mint_id: candidate.mint_id,
        p_success: true,
        p_nft_address: nftAddress.toString(),
        p_metadata_uri: metadataUri,
        p_metadata: metadata,
      });
      succeeded += 1;
    } catch {
      unknown += 1;
    }
  }
  return { candidates: candidates.length, succeeded, failed, unknown };
}
