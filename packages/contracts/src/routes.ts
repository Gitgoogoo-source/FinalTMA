import { z } from "zod";

import {
  emptyObjectSchema,
  identifierSchema,
  positiveIntegerSchema,
  recordSchema,
  uuidSchema,
} from "./common.ts";

export type HttpMethod = "GET" | "POST";
export type Gateway = "app" | "integrations" | "jobs";
export type Compatibility = "c1" | "c2" | "c4";

export type RouteDefinition = {
  id: string;
  method: HttpMethod;
  path: string;
  gateway: Gateway;
  compatibility: Compatibility;
  auth: boolean;
  idempotent: boolean;
  input: z.ZodType;
  response: z.ZodType;
};

const query = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  operation_id: uuidSchema.optional(),
  template_id: identifierSchema.optional(),
  tier: identifierSchema.optional(),
  status: identifierSchema.optional(),
});

const action = z.object({}).catchall(z.unknown());
const template = z.object({ template_id: identifierSchema });
const templateQuantity = template.extend({ quantity: positiveIntegerSchema });
const mintAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), template_id: identifierSchema }),
  z.object({
    action: z.literal("submit"),
    mint_id: uuidSchema,
    transaction_hash: identifierSchema,
  }),
  z.object({ action: z.literal("cancel"), mint_id: uuidSchema }),
]);

const definitions: Array<Omit<RouteDefinition, "response">> = [
  {
    id: "health",
    method: "GET",
    path: "/api/health",
    gateway: "app",
    compatibility: "c1",
    auth: false,
    idempotent: false,
    input: query,
  },
  {
    id: "auth.telegram",
    method: "POST",
    path: "/api/auth/telegram",
    gateway: "app",
    compatibility: "c2",
    auth: false,
    idempotent: false,
    input: z.object({ init_data: z.string().min(1).max(16384) }),
  },
  {
    id: "me.bootstrap",
    method: "GET",
    path: "/api/me/bootstrap",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "me.assets",
    method: "GET",
    path: "/api/me/assets",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "catalog.get",
    method: "GET",
    path: "/api/catalog",
    gateway: "app",
    compatibility: "c4",
    auth: false,
    idempotent: false,
    input: query,
  },
  ...getRoutes("boxes", ["list", "rewards", "pity", "result"], "c2"),
  {
    id: "boxes.create_open_order",
    method: "POST",
    path: "/api/boxes/create-open-order",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({
      box_tier: z.enum(["normal", "rare", "legendary"]),
      draw_count: z.union([z.literal(1), z.literal(10)]),
    }),
  },
  {
    id: "topup.create_order",
    method: "POST",
    path: "/api/payments/kcoin-topup/create-order",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({
      amount: positiveIntegerSchema,
      intent: recordSchema.optional(),
    }),
  },
  {
    id: "topup.status",
    method: "GET",
    path: "/api/payments/kcoin-topup/status",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: false,
    input: query,
  },
  ...getRoutes("inventory", ["list", "summary", "group-items", "detail"], "c2"),
  {
    id: "inventory.evolve",
    method: "POST",
    path: "/api/inventory/evolve",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: template,
  },
  {
    id: "inventory.decompose",
    method: "POST",
    path: "/api/inventory/decompose",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: templateQuantity,
  },
  ...getRoutes(
    "market",
    [
      "listings",
      "sellable-items",
      "sell-rules",
      "my-listings",
      "my-listing-stats",
    ],
    "c2",
  ),
  {
    id: "market.template_detail",
    method: "GET",
    path: "/api/market/template-detail",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query.extend({ template_id: identifierSchema }),
  },
  {
    id: "market.buy",
    method: "POST",
    path: "/api/market/buy",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: templateQuantity,
  },
  {
    id: "market.create_listing",
    method: "POST",
    path: "/api/market/create-listing",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: templateQuantity,
  },
  {
    id: "market.cancel_listing",
    method: "POST",
    path: "/api/market/cancel-listing",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: template,
  },
  ...getRoutes("album", ["progress", "items"], "c2"),
  {
    id: "album.claim_reward",
    method: "POST",
    path: "/api/album/claim-reward",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({ chain_id: identifierSchema }),
  },
  ...getRoutes(
    "tasks",
    [
      "list",
      "overview",
      "check-in-status",
      "invite-stats",
      "referral-link",
      "prepared-share-message",
    ],
    "c2",
  ),
  {
    id: "tasks.claim",
    method: "POST",
    path: "/api/tasks/claim",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({ task_code: identifierSchema }),
  },
  {
    id: "tasks.check_in",
    method: "POST",
    path: "/api/tasks/check-in",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: emptyObjectSchema,
  },
  {
    id: "tasks.bind_referral",
    method: "POST",
    path: "/api/tasks/bind-referral",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({ code: identifierSchema }),
  },
  {
    id: "tasks.share_event",
    method: "POST",
    path: "/api/tasks/share-event",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: z.object({ event: z.enum(["copy_link", "telegram_invite"]) }),
  },
  {
    id: "vip.status",
    method: "GET",
    path: "/api/vip/status",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: false,
    input: query,
  },
  ...postRoutes("vip", ["create-order", "claim-daily", "claim-free-box"], "c2"),
  {
    id: "wallet.challenge",
    method: "POST",
    path: "/api/wallet/challenge",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
  },
  {
    id: "wallet.connect",
    method: "POST",
    path: "/api/wallet/connect",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: true,
    input: action,
  },
  {
    id: "wallet.proof",
    method: "POST",
    path: "/api/wallet/proof",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: true,
    input: action,
  },
  {
    id: "wallet.status",
    method: "GET",
    path: "/api/wallet/status",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "wallet.disconnect",
    method: "POST",
    path: "/api/wallet/disconnect",
    gateway: "app",
    compatibility: "c1",
    auth: true,
    idempotent: true,
    input: action,
  },
  {
    id: "wallet.mint",
    method: "POST",
    path: "/api/wallet/mint",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: true,
    input: mintAction,
  },
  {
    id: "wallet.mint_status",
    method: "GET",
    path: "/api/wallet/mint-status",
    gateway: "app",
    compatibility: "c2",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "telegram.payment_support",
    method: "GET",
    path: "/api/telegram/payment-support",
    gateway: "app",
    compatibility: "c1",
    auth: false,
    idempotent: false,
    input: query,
  },
  {
    id: "telegram.webhook",
    method: "POST",
    path: "/api/telegram/webhook",
    gateway: "integrations",
    compatibility: "c1",
    auth: false,
    idempotent: false,
    input: action,
  },
  {
    id: "expeditions.bootstrap",
    method: "GET",
    path: "/api/expeditions/bootstrap",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "expeditions.eligible_items",
    method: "GET",
    path: "/api/expeditions/eligible-items",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query.extend({
      tier: z.enum(["normal", "intermediate", "advanced"]),
    }),
  },
  {
    id: "expeditions.result",
    method: "GET",
    path: "/api/expeditions/result",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query.extend({ operation_id: uuidSchema }),
  },
  {
    id: "expeditions.create",
    method: "POST",
    path: "/api/expeditions/create",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: true,
    input: z.object({
      tier: z.enum(["normal", "intermediate", "advanced"]),
      items: z.array(templateQuantity).min(1).max(3),
    }),
  },
  {
    id: "expeditions.claim",
    method: "POST",
    path: "/api/expeditions/claim",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: true,
    input: z.object({ expedition_id: uuidSchema }),
  },
  {
    id: "wheel.bootstrap",
    method: "GET",
    path: "/api/wheel/bootstrap",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "wheel.spin",
    method: "POST",
    path: "/api/wheel/spin",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: true,
    input: z.object({ count: z.union([z.literal(1), z.literal(10)]) }),
  },
  {
    id: "wheel.result",
    method: "GET",
    path: "/api/wheel/result",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query,
  },
  {
    id: "operations.result",
    method: "GET",
    path: "/api/operations/result",
    gateway: "app",
    compatibility: "c4",
    auth: true,
    idempotent: false,
    input: query.extend({ operation_id: uuidSchema }),
  },
  {
    id: "nft.metadata",
    method: "GET",
    path: "/api/nft-metadata/:nft_id",
    gateway: "app",
    compatibility: "c4",
    auth: false,
    idempotent: false,
    input: z.object({ nft_id: z.coerce.number().int().nonnegative() }),
  },
  ...jobRoutes(),
];

export const routes: RouteDefinition[] = definitions.map((route) => ({
  ...route,
  response: recordSchema,
}));

export function findRoute(
  method: string,
  pathname: string,
  gateway: Gateway,
): { route: RouteDefinition; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.gateway !== gateway || route.method !== method) continue;
    const pattern = new URLPattern({ pathname: route.path });
    const match = pattern.exec({ pathname });
    if (match) return { route, params: compactParams(match.pathname.groups) };
  }
  return null;
}

export function findRouteByPath(
  pathname: string,
  gateway: Gateway,
): RouteDefinition | null {
  return (
    routes.find(
      (route) =>
        route.gateway === gateway &&
        new URLPattern({ pathname: route.path }).test({ pathname }),
    ) ?? null
  );
}

function compactParams(
  groups: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(groups).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function getRoutes(
  domain: string,
  names: string[],
  compatibility: Compatibility,
): Array<Omit<RouteDefinition, "response">> {
  return names.map((name) => ({
    id: `${domain}.${name.replaceAll("-", "_")}`,
    method: "GET",
    path: `/api/${domain}/${name}`,
    gateway: "app",
    compatibility,
    auth: true,
    idempotent: false,
    input: query,
  }));
}

function postRoutes(
  domain: string,
  names: string[],
  compatibility: Compatibility,
): Array<Omit<RouteDefinition, "response">> {
  return names.map((name) => ({
    id: `${domain}.${name.replaceAll("-", "_")}`,
    method: "POST",
    path: `/api/${domain}/${name}`,
    gateway: "app",
    compatibility,
    auth: true,
    idempotent: true,
    input: emptyObjectSchema,
  }));
}

function jobRoutes(): Array<Omit<RouteDefinition, "response">> {
  return [
    "reconcile-payments",
    "reconcile-mints",
    "cleanup-idempotency",
    "monitor-invariants",
  ].map((name) => ({
    id: `jobs.${name.replaceAll("-", "_")}`,
    method: "GET",
    path: `/api/jobs/${name}`,
    gateway: "jobs",
    compatibility: "c4",
    auth: false,
    idempotent: false,
    input: query,
  }));
}
