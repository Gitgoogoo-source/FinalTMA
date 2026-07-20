import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import {
  chainTypeSchema,
  emptyObjectSchema,
  identifierSchema,
  nonNegativeIntegerSchema,
  raritySchema,
} from "../../common/schemas.ts";

const albumNodeSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    unlocked: z.boolean(),
    owned_count: nonNegativeIntegerSchema,
  })
  .strict();

const albumChainSchema = z
  .object({
    chain_id: z.string(),
    chain_type: chainTypeSchema,
    theme: z.string(),
    unlocked_count: z.number().int().min(0).max(3),
    completed: z.boolean(),
    claimable: z.boolean(),
    claimed: z.boolean(),
    reward_fgems: z.union([z.literal(100), z.literal(300), z.literal(800)]),
    nodes: z.array(albumNodeSchema).length(3),
  })
  .strict()
  .superRefine((chain, context) => {
    const unlockedCount = chain.nodes.filter((node) => node.unlocked).length;
    if (chain.unlocked_count !== unlockedCount)
      context.addIssue({
        code: "custom",
        message: "Chain unlocked_count must match explicit node states",
        path: ["unlocked_count"],
      });
    if (chain.completed !== (unlockedCount === 3))
      context.addIssue({
        code: "custom",
        message: "Chain completed must match explicit node states",
        path: ["completed"],
      });
    if (chain.claimable !== (chain.completed && !chain.claimed))
      context.addIssue({
        code: "custom",
        message: "Chain claimable must match completed and claimed",
        path: ["claimable"],
      });
    if (chain.claimed && !chain.completed)
      context.addIssue({
        code: "custom",
        message: "Claimed album chains must remain completed",
        path: ["claimed"],
      });
    const expectedReward =
      chain.chain_type === "normal"
        ? 100
        : chain.chain_type === "advanced"
          ? 300
          : 800;
    if (chain.reward_fgems !== expectedReward)
      context.addIssue({
        code: "custom",
        message: "Album reward must match chain_type",
        path: ["reward_fgems"],
      });
    if (
      [...chain.nodes]
        .sort((left, right) => left.stage - right.stage)
        .some((node, index) => node.stage !== index + 1)
    )
      context.addIssue({
        code: "custom",
        message: "Album nodes must contain one entry for every stage",
        path: ["nodes"],
      });
  });

export const albumRoutes = [
  defineRoute({
    id: "album.get",
    method: "GET",
    path: "/api/album",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        unlocked_count: z.number().int().min(0).max(210),
        total_count: z.literal(210),
        completed_chain_count: z.number().int().min(0).max(70),
        total_chain_count: z.literal(70),
        claimable_count: z.number().int().min(0).max(70),
        chains: z.array(albumChainSchema).length(70),
      })
      .strict()
      .superRefine((album, context) => {
        const unlockedCount = album.chains.reduce(
          (total, chain) => total + chain.unlocked_count,
          0,
        );
        const completedCount = album.chains.filter(
          (chain) => chain.completed,
        ).length;
        const claimableCount = album.chains.filter(
          (chain) => chain.claimable,
        ).length;
        const typeCounts = {
          normal: album.chains.filter((chain) => chain.chain_type === "normal")
            .length,
          advanced: album.chains.filter(
            (chain) => chain.chain_type === "advanced",
          ).length,
          top: album.chains.filter((chain) => chain.chain_type === "top")
            .length,
        };
        if (album.unlocked_count !== unlockedCount)
          context.addIssue({
            code: "custom",
            message: "Album unlocked_count must match chain nodes",
            path: ["unlocked_count"],
          });
        if (album.completed_chain_count !== completedCount)
          context.addIssue({
            code: "custom",
            message: "Album completed_chain_count must match chains",
            path: ["completed_chain_count"],
          });
        if (album.claimable_count !== claimableCount)
          context.addIssue({
            code: "custom",
            message: "Album claimable_count must match chains",
            path: ["claimable_count"],
          });
        if (
          typeCounts.normal !== 40 ||
          typeCounts.advanced !== 20 ||
          typeCounts.top !== 10
        )
          context.addIssue({
            code: "custom",
            message:
              "Album must contain 40 normal, 20 advanced and 10 top chains",
            path: ["chains"],
          });
      }),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "album.claim",
    method: "POST",
    path: "/api/album/:chain_id/claim",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets"],
    input: z.object({ chain_id: identifierSchema }).strict(),
    output: z
      .object({
        chain_id: identifierSchema,
        chain_type: chainTypeSchema,
        theme: z.string().min(1),
        reward_fgems: z.union([z.literal(100), z.literal(300), z.literal(800)]),
        claimed: z.literal(true),
      })
      .strict()
      .superRefine((claim, context) => {
        const expectedReward =
          claim.chain_type === "normal"
            ? 100
            : claim.chain_type === "advanced"
              ? 300
              : 800;
        if (claim.reward_fgems !== expectedReward)
          context.addIssue({
            code: "custom",
            message: "Album claim reward must match chain_type",
            path: ["reward_fgems"],
          });
      }),
    errors: [
      "ALBUM_CHAIN_INCOMPLETE",
      "ALBUM_REWARD_ALREADY_CLAIMED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
