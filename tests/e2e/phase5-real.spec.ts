import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHmac, createPrivateKey, randomUUID, sign } from "node:crypto";
import { basename } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  buildTonProofDigest,
  parseRawTonAddress,
} from "../../packages/server/src/ton/tonConnect";

type ApiEnvelope<T> = {
  ok: boolean;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type DbClient = {
  supabaseUrl: string;
  containerName: string;
};

type Phase5Fixture = {
  runId: string;
  userId: string;
  boxId: string;
  poolVersionId: string;
  templateId: string;
  formId: string;
  seedMintItemId: string;
  boxName: string;
  itemName: string;
  collectionAddress: string;
};

type PendingOrderFixture = {
  drawOrderId: string;
  starOrderId: string;
  expiresAt: string;
};

type WalletChallengeResponse = {
  challenge?: string;
  ton_proof_payload?: string;
  tonProofPayload?: string;
};

const BOT_TOKEN =
  process.env.PHASE5_REAL_E2E_BOT_TOKEN ??
  "123456789:phase5-real-e2e-bot-token";
const PENDING_STARS_PAYMENT_STORAGE_KEY = "tma:box:pending-stars-payment-order";
const TON_PROOF_DOMAIN = "127.0.0.1";
const TON_COLLECTION_ADDRESS =
  process.env.PHASE5_REAL_E2E_TON_COLLECTION_ADDRESS ??
  "0:1111111111111111111111111111111111111111111111111111111111111111";

const RAW_WALLET_ADDRESS =
  "0:676898db2fc6d59bc0590be076943831b0a27fa0441b194846b4327d96aea388";
const WALLET_PUBLIC_KEY =
  "95aac656e719d06b884b104968ee919afac71b5038f5b55a7e32b2dc4023d1f8";
const WALLET_STATE_INIT =
  "te6cckECFgEAAwQAAgE0ARUBFP8A9KQT9LzyyAsCAgEgAxACAUgEBwLm0AHQ0wMhcbCSXwTgItdJwSCSXwTgAtMfIYIQcGx1Z70ighBkc3RyvbCSXwXgA/pAMCD6RAHIygfL/8nQ7UTQgQFA1yH0BDBcgQEI9ApvoTGzkl8H4AXTP8glghBwbHVnupI4MOMNA4IQZHN0crqSXwbjDQUGAHgB+gD0BDD4J28iMFAKoSG+8uBQghBwbHVngx6xcIAYUATLBSbPFlj6Ahn0AMtpF8sfUmDLPyDJgED7AAYAilAEgQEI9Fkw7UTQgQFA1yDIAc8W9ADJ7VQBcrCOI4IQZHN0coMesXCAGFAFywVQA88WI/oCE8tqyx/LP8mAQPsAkl8D4gIBIAgPAgEgCQ4CAVgKCwA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIAwNABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AABG4yX7UTQ1wsfgAWb0kK29qJoQICga5D6AhhHDUCAhHpJN9KZEM5pA+n/mDeBKAG3gQFImHFZ8xhAT48oMI1xgg0x/TH9MfAvgju/Jk7UTQ0x/TH9P/9ATRUUO68qFRUbryogX5AVQQZPkQ8qP4ACSkyMsfUkDLH1Iwy/9SEPQAye1U+A8B0wchwACfbFGTINdKltMH1AL7AOgw4CHAAeMAIcAC4wABwAORMOMNA6TIyx8Syx/L/xESExQAbtIH+gDU1CL5AAXIygcVy//J0Hd0gBjIywXLAiLPFlAF+gIUy2sSzMzJc/sAyEAUgQEI9FHypwIAcIEBCNcY+gDTP8hUIEeBAQj0UfKnghBub3RlcHSAGMjLBcsCUAbPFlAE+gIUy2oSyx/LP8lz+wACAGyBAQjXGPoA0z8wUiSBAQj0WfKnghBkc3RycHSAGMjLBcsCUAXPFlAD+gITy2rLHxLLP8lz+wAACvQAye1UAFEAAAAAKamjF5WqxlbnGdBriEsQSWjukZr6xxtQOPW1Wn4ystxAI9H4QEc5mKQ=";
const WALLET_PRIVATE_KEY_JWK = {
  crv: "Ed25519",
  d: "YVau-JwBmiNk26E2aPlr9zlsGqOy-kxDk4RpdOTtZ8s",
  x: "larGVucZ0GuISxBJaO6RmvrHG1A49bVafjKy3EAj0fg",
  kty: "OKP",
} as const;

test.skip(
  process.env.PHASE5_REAL_E2E !== "1",
  "Phase 5 real E2E requires `pnpm test:e2e:phase5-real`.",
);

test("第五阶段真实链路：支付、钱包验证、Mint 队列和刷新恢复", async ({
  page,
}) => {
  const db = createPhase5DbClient();
  const runId = createRunId();
  const telegramUserId = createTelegramUserId();
  const initData = createTelegramInitData({
    id: telegramUserId,
    first_name: "Phase5",
    last_name: "RealE2E",
    username: `phase5_real_${runId}`,
  });

  const loginResponse = await page.request.post("/api/auth/telegram", {
    data: {
      initData,
      clientContext: {
        platform: "phase5-real-e2e",
      },
    },
  });
  const loginBody = await loginResponse.json();

  expect(loginResponse.ok(), JSON.stringify(loginBody)).toBe(true);
  expect(loginBody.ok, JSON.stringify(loginBody)).toBe(true);

  const userId = loginBody.data.user.id as string;
  const fixture = await seedPhase5Fixture(db, {
    runId,
    userId,
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(initData)}`);
  await expect(page.getByTestId("box-page")).toBeVisible();
  await expect(page.getByText(fixture.boxName).first()).toBeVisible();
  const fixtureBoxButton = page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(fixture.boxName)}\\b`),
  });
  await fixtureBoxButton.click();
  await expect(fixtureBoxButton).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /开 1 次/ }).click();
  await expect(page.getByText(fixture.itemName).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/返还 100 K-coin/).first()).toBeVisible();
  await expectPaidOrderFulfilled(db, fixture);

  await page.getByRole("button", { name: "确认" }).click();

  const pendingOrder = await seedPendingPaymentOrder(db, fixture);
  const pendingStatus = await apiGet<Record<string, unknown>>(
    page,
    `/api/boxes/payment-status?orderId=${pendingOrder.drawOrderId}`,
  );

  expect(pendingStatus.payment_order_status).toBe("invoice_created");
  await setPendingStarsPaymentRestore(page, pendingOrder);
  await page.reload();

  await expect(
    page.getByText("已恢复上次未完成订单，正在向服务端确认支付状态。"),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", {
      name: /等待 Stars 支付|支付订单已创建|等待支付/,
    }),
  ).toBeVisible();
  await expectPendingOrderInDb(db, pendingOrder);

  await connectAndVerifyWallet(page, runId);
  await expectWalletVerified(db, userId);

  await page.goto(`/collection?mockInitData=${encodeURIComponent(initData)}`);
  await expect(page.getByTestId("collection-page")).toBeVisible();
  await expect(page.getByText(fixture.itemName).first()).toBeVisible();

  const walletButton = page.locator(".wallet-entry-button").first();
  await expect(walletButton).toContainText("verified");
  await walletButton.click();
  const walletStatusDialog = page.getByRole("dialog", { name: "钱包状态" });
  await expect(walletStatusDialog).toBeVisible();
  await expect(page.getByText("钱包验证已通过")).toBeVisible();
  await walletStatusDialog.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "详情" }).click();
  const detailDialog = page.getByRole("dialog", { name: fixture.itemName });
  await expect(detailDialog).toBeVisible();
  const mintButton = detailDialog.getByRole("button", { name: "Mint NFT" });
  await expect(mintButton).toBeEnabled();
  await mintButton.click();

  await expect(page.getByText("Mint 已入队")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Mint 队列" })).toBeVisible();
  await expect(page.getByText("排队中").first()).toBeVisible();
  await expectMintQueued(db, userId);

  await page.reload();
  await expect(page.getByTestId("collection-page")).toBeVisible();
  const refreshedWalletButton = page.locator(".wallet-entry-button").first();
  await expect(refreshedWalletButton).toContainText("verified");
  await refreshedWalletButton.click();
  await page.getByRole("button", { name: "Mint 队列" }).click();
  await expect(page.getByRole("dialog", { name: "Mint 队列" })).toBeVisible();
  await expect(page.getByText("排队中").first()).toBeVisible();
});

async function seedPhase5Fixture(
  db: DbClient,
  input: { runId: string; userId: string },
): Promise<Phase5Fixture> {
  const seriesId = randomUUID();
  const templateId = randomUUID();
  const formId = randomUUID();
  const boxId = randomUUID();
  const poolVersionId = randomUUID();
  const poolItemId = randomUUID();
  const collectionId = randomUUID();
  const seedMintItemId = randomUUID();
  const boxName = `Phase 5 真实支付盒 ${input.runId}`;
  const itemName = `Phase 5 Mint 藏品 ${input.runId}`;

  await executeSql(
    db,
    buildPhase5FixtureSql({
      runId: input.runId,
      userId: input.userId,
      seriesId,
      templateId,
      formId,
      boxId,
      poolVersionId,
      poolItemId,
      collectionId,
      seedMintItemId,
      boxName,
      itemName,
      collectionAddress: TON_COLLECTION_ADDRESS,
    }),
  );

  return {
    runId: input.runId,
    userId: input.userId,
    boxId,
    poolVersionId,
    templateId,
    formId,
    seedMintItemId,
    boxName,
    itemName,
    collectionAddress: TON_COLLECTION_ADDRESS,
  };
}

function buildPhase5FixtureSql(input: {
  runId: string;
  userId: string;
  seriesId: string;
  templateId: string;
  formId: string;
  boxId: string;
  poolVersionId: string;
  poolItemId: string;
  collectionId: string;
  seedMintItemId: string;
  boxName: string;
  itemName: string;
  collectionAddress: string;
}): string {
  const metadata = `jsonb_build_object('phase5_real_e2e', true, 'run_id', ${sqlString(input.runId)})`;
  const imageUrl = `https://assets.example.test/phase5/${input.runId}/card.png`;
  const metadataUrl = `https://assets.example.test/phase5/${input.runId}/metadata.json`;
  const contentBaseUrl = `https://assets.example.test/phase5/${input.runId}`;

  return `
begin;

insert into ops.feature_flags (key, enabled, description, rollout)
values
  ('FEATURE_STARS_PAYMENT_ENABLED', true, 'Phase 5 real E2E local payment gate.', ${metadata}),
  ('FEATURE_TON_MINT_ENABLED', true, 'Phase 5 real E2E local mint gate.', ${metadata}),
  ('FEATURE_WALLET_PROOF_ENABLED', true, 'Phase 5 real E2E local wallet proof gate.', ${metadata}),
  ('FEATURE_WALLET_SYNC_ENABLED', true, 'Phase 5 real E2E local wallet sync gate.', ${metadata}),
  ('gacha.open_box', true, 'Phase 5 real E2E local gacha gate.', ${metadata}),
  ('wallet.ton_connect', true, 'Phase 5 real E2E local wallet gate.', ${metadata}),
  ('onchain.mint', true, 'Phase 5 real E2E local onchain gate.', ${metadata})
on conflict (key) do update
set enabled = excluded.enabled,
    rollout = ops.feature_flags.rollout || excluded.rollout,
    updated_at = now();

insert into catalog.series (
  id, slug, display_name, description, status, sort_order, metadata
) values (
  ${sqlUuid(input.seriesId)},
  ${sqlString(`phase5-real-${input.runId}`)},
  ${sqlString(`Phase 5 Real 系列 ${input.runId}`)},
  'Phase 5 real E2E fixture.',
  'active',
  -20000,
  ${metadata}
);

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  subtitle,
  description,
  rarity_code,
  type_code,
  series_id,
  base_power,
  max_level,
  release_status,
  tradeable,
  upgradeable,
  evolvable,
  decomposable,
  nft_mintable,
  sort_order,
  metadata
) values (
  ${sqlUuid(input.templateId)},
  ${sqlString(`phase5-real-${input.runId}`)},
  ${sqlString(input.itemName)},
  'Phase 5 real E2E',
  'Created by the Phase 5 real E2E acceptance test.',
  'COMMON',
  'CHARACTER',
  ${sqlUuid(input.seriesId)},
  10,
  10,
  'active',
  true,
  true,
  true,
  true,
  true,
  -20000,
  ${metadata}
);

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  base_power_bonus,
  is_default,
  metadata
) values (
  ${sqlUuid(input.formId)},
  ${sqlUuid(input.templateId)},
  1,
  'base',
  ${sqlString(`${input.itemName} 初阶`)},
  'Phase 5 real E2E form.',
  ${sqlString(imageUrl)},
  ${sqlString(imageUrl)},
  ${sqlString(imageUrl)},
  0,
  true,
  ${metadata}
);

insert into catalog.collectible_media (
  template_id, form_id, media_type, url, mime_type, sort_order, metadata
) values
  (${sqlUuid(input.templateId)}, ${sqlUuid(input.formId)}, 'card', ${sqlString(imageUrl)}, 'image/png', 1, ${metadata}),
  (${sqlUuid(input.templateId)}, ${sqlUuid(input.formId)}, 'nft_image', ${sqlString(imageUrl)}, 'image/png', 2, ${metadata}),
  (${sqlUuid(input.templateId)}, ${sqlUuid(input.formId)}, 'metadata', ${sqlString(metadataUrl)}, 'application/json', 3, ${metadata});

insert into gacha.blind_boxes (
  id,
  slug,
  display_name,
  description,
  tier,
  status,
  price_stars,
  total_stock,
  remaining_stock,
  open_reward_kcoin,
  cover_image_url,
  hero_image_url,
  sort_order,
  metadata
) values (
  ${sqlUuid(input.boxId)},
  ${sqlString(`phase5-real-${input.runId}`)},
  ${sqlString(input.boxName)},
  'Phase 5 real E2E blind box.',
  'normal',
  'active',
  10,
  1000,
  1000,
  100,
  ${sqlString(imageUrl)},
  ${sqlString(imageUrl)},
  -20000,
  ${metadata}
);

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  published_at,
  effective_from,
  config_snapshot
) values (
  ${sqlUuid(input.poolVersionId)},
  ${sqlUuid(input.boxId)},
  1,
  'active',
  10000,
  now(),
  now() - interval '1 minute',
  ${metadata}
);

insert into gacha.drop_pool_items (
  id,
  pool_version_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  is_pity_eligible,
  is_featured,
  sort_order,
  metadata
) values (
  ${sqlUuid(input.poolItemId)},
  ${sqlUuid(input.poolVersionId)},
  ${sqlUuid(input.templateId)},
  ${sqlUuid(input.formId)},
  'COMMON',
  10000,
  10000,
  true,
  true,
  1,
  ${metadata}
);

insert into onchain.nft_collections (
  id,
  code,
  chain,
  network,
  collection_address,
  owner_address,
  standard,
  metadata_url,
  content_base_url,
  status,
  metadata
) values (
  ${sqlUuid(input.collectionId)},
  ${sqlString(`phase5-real-${input.runId}`)},
  'TON',
  'mainnet',
  ${sqlString(input.collectionAddress)},
  ${sqlString(RAW_WALLET_ADDRESS)},
  'TEP-62',
  ${sqlString(`${contentBaseUrl}/collection.json`)},
  ${sqlString(contentBaseUrl)},
  'active',
  ${metadata}
) on conflict (collection_address) do update
set code = excluded.code,
    chain = excluded.chain,
    network = excluded.network,
    owner_address = excluded.owner_address,
    standard = excluded.standard,
    metadata_url = excluded.metadata_url,
    content_base_url = excluded.content_base_url,
    status = excluded.status,
    metadata = onchain.nft_collections.metadata || excluded.metadata,
    updated_at = now();

insert into inventory.item_instances (
  id,
  owner_user_id,
  template_id,
  form_id,
  level,
  power,
  status,
  source_type,
  nft_mint_status,
  acquired_at,
  metadata
) values (
  ${sqlUuid(input.seedMintItemId)},
  ${sqlUuid(input.userId)},
  ${sqlUuid(input.templateId)},
  ${sqlUuid(input.formId)},
  1,
  10,
  'available',
  'admin',
  'not_minted',
  now() - interval '2 minutes',
  ${metadata}
);

insert into inventory.item_instance_events (
  item_instance_id, user_id, event_type, source_type, before_state, after_state, metadata
) values (
  ${sqlUuid(input.seedMintItemId)},
  ${sqlUuid(input.userId)},
  'created',
  'admin',
  '{}'::jsonb,
  jsonb_build_object('status', 'available', 'level', 1, 'power', 10),
  ${metadata}
);

commit;
`;
}

async function seedPendingPaymentOrder(
  db: DbClient,
  fixture: Phase5Fixture,
): Promise<PendingOrderFixture> {
  const drawOrderId = randomUUID();
  const starOrderId = randomUUID();
  const invoicePayload = `phase5_pending_${fixture.runId}_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const idempotencyKey = `phase5-real:${fixture.runId}:pending`;
  const metadata = `jsonb_build_object('phase5_real_e2e', true, 'run_id', ${sqlString(fixture.runId)}, 'pending_restore', true)`;

  await executeSql(
    db,
    `
begin;

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  business_id,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  description,
  idempotency_key,
  expires_at,
  metadata
) values (
  ${sqlUuid(starOrderId)},
  ${sqlUuid(fixture.userId)},
  'gacha_open',
  ${sqlUuid(drawOrderId)},
  'invoice_created',
  10,
  ${sqlString(invoicePayload)},
  ${sqlString(fixture.boxName)},
  'Phase 5 real E2E pending payment restore.',
  ${sqlString(idempotencyKey)},
  ${sqlString(expiresAt)}::timestamptz,
  ${metadata}
);

insert into gacha.draw_orders (
  id,
  user_id,
  box_id,
  pool_version_id,
  payment_star_order_id,
  status,
  quantity,
  unit_price_stars,
  discount_bps,
  total_price_stars,
  open_reward_kcoin,
  invoice_payload,
  idempotency_key,
  payment_provider,
  payment_status,
  star_amount,
  telegram_invoice_payload,
  draw_count,
  metadata
) values (
  ${sqlUuid(drawOrderId)},
  ${sqlUuid(fixture.userId)},
  ${sqlUuid(fixture.boxId)},
  ${sqlUuid(fixture.poolVersionId)},
  ${sqlUuid(starOrderId)},
  'invoice_created',
  1,
  10,
  0,
  10,
  100,
  ${sqlString(invoicePayload)},
  ${sqlString(idempotencyKey)},
  'telegram_stars',
  'pending',
  10,
  ${sqlString(invoicePayload)},
  1,
  ${metadata}
);

insert into payments.star_invoices (
  star_order_id,
  invoice_link,
  payload,
  status,
  raw_request,
  raw_response,
  open_mode,
  bot_api_method,
  expires_at
) values (
  ${sqlUuid(starOrderId)},
  ${sqlString(`https://t.me/invoice/${fixture.runId}`)},
  ${sqlString(invoicePayload)},
  'created',
  ${metadata},
  ${metadata},
  'web_app_open_invoice',
  'createInvoiceLink',
  ${sqlString(expiresAt)}::timestamptz
);

commit;
`,
  );

  return {
    drawOrderId,
    starOrderId,
    expiresAt,
  };
}

async function connectAndVerifyWallet(
  page: Page,
  runId: string,
): Promise<void> {
  const connectKey = `phase5-real:${runId}:wallet-connect`;
  const connectResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/wallet/connect",
    {
      account: {
        address: RAW_WALLET_ADDRESS,
        chain: "-239",
        publicKey: WALLET_PUBLIC_KEY,
        walletStateInit: WALLET_STATE_INIT,
      },
      wallet_app_name: "Tonkeeper",
      idempotency_key: connectKey,
    },
    connectKey,
  );

  expect(connectResult.status).toBe("connected_unverified");

  const challenge = await apiPost<WalletChallengeResponse>(
    page,
    "/api/wallet/challenge",
    {},
    null,
  );
  const proofChallenge =
    challenge.ton_proof_payload ??
    challenge.tonProofPayload ??
    challenge.challenge;

  expect(proofChallenge).toBeTruthy();

  const proofKey = `phase5-real:${runId}:wallet-proof`;
  const proofPayload = await createSignedProof({
    challenge: proofChallenge as string,
    domain: TON_PROOF_DOMAIN,
  });
  const proofResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/wallet/proof",
    {
      ...proofPayload,
      wallet_app_name: "Tonkeeper",
      idempotency_key: proofKey,
    },
    proofKey,
  );

  expect(proofResult.status).toBe("verified");
  expect(proofResult.address).toBe(RAW_WALLET_ADDRESS);
}

async function createSignedProof(input: {
  challenge: string;
  domain: string;
}): Promise<{
  account: {
    address: string;
    chain: string;
    publicKey: string;
    walletStateInit: string;
  };
  proof: {
    timestamp: number;
    domain: {
      lengthBytes: number;
      value: string;
    };
    payload: string;
    signature: string;
  };
  challenge: string;
}> {
  const privateKey = createPrivateKey({
    key: WALLET_PRIVATE_KEY_JWK,
    format: "jwk",
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const proof = {
    timestamp,
    domain: {
      lengthBytes: Buffer.byteLength(input.domain, "utf8"),
      value: input.domain,
    },
    payload: input.challenge,
    signature: "",
  };
  const messageHash = buildTonProofDigest(
    parseRawTonAddress(RAW_WALLET_ADDRESS),
    proof,
  );

  return {
    account: {
      address: RAW_WALLET_ADDRESS,
      chain: "-239",
      publicKey: WALLET_PUBLIC_KEY,
      walletStateInit: WALLET_STATE_INIT,
    },
    proof: {
      ...proof,
      signature: sign(null, messageHash, privateKey).toString("base64"),
    },
    challenge: input.challenge,
  };
}

async function setPendingStarsPaymentRestore(
  page: Page,
  pendingOrder: PendingOrderFixture,
): Promise<void> {
  await page.evaluate(
    ({ expiresAt, key, orderId }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          orderId,
          expiresAt,
          savedAt: new Date().toISOString(),
        }),
      );
    },
    {
      key: PENDING_STARS_PAYMENT_STORAGE_KEY,
      orderId: pendingOrder.drawOrderId,
      expiresAt: pendingOrder.expiresAt,
    },
  );
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return apiRequest<T>(page, path, {
    method: "GET",
  });
}

async function apiPost<T>(
  page: Page,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): Promise<T> {
  return apiRequest<T>(page, path, {
    method: "POST",
    body,
    headers: idempotencyKey
      ? {
          "x-idempotency-key": idempotencyKey,
        }
      : {},
  });
}

async function apiRequest<T>(
  page: Page,
  path: string,
  request: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const result = await page.evaluate(
    async ({ path: requestPath, requestInit }) => {
      const headers = new Headers(requestInit.headers);

      if (requestInit.body !== undefined) {
        headers.set("content-type", "application/json");
      }

      const fetchInit: RequestInit = {
        method: requestInit.method,
        credentials: "include",
        headers,
      };

      if (requestInit.body !== undefined) {
        fetchInit.body = JSON.stringify(requestInit.body);
      }

      const response = await fetch(requestPath, fetchInit);
      const payload = (await response.json()) as ApiEnvelope<unknown>;

      return {
        status: response.status,
        payload,
      };
    },
    {
      path,
      requestInit: request,
    },
  );

  expect(result.status, JSON.stringify(result.payload)).toBeLessThan(400);
  expect(result.payload.ok, JSON.stringify(result.payload)).toBe(true);

  return result.payload.data as T;
}

async function expectPaidOrderFulfilled(
  db: DbClient,
  fixture: Phase5Fixture,
): Promise<void> {
  const rows = await selectRows<{
    draw_status: string;
    payment_status: string | null;
    star_status: string | null;
    result_count: number;
  }>(
    db,
    `
select
  d.status as draw_status,
  d.payment_status,
  so.status as star_status,
  count(dr.id)::integer as result_count
from gacha.draw_orders d
left join payments.star_orders so on so.id = d.payment_star_order_id
left join gacha.draw_results dr on dr.draw_order_id = d.id
where d.user_id = ${sqlUuid(fixture.userId)}
  and d.box_id = ${sqlUuid(fixture.boxId)}
group by d.id, d.status, d.payment_status, so.status, d.created_at
order by d.created_at desc
limit 1
`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    draw_status: "completed",
    star_status: "fulfilled",
    result_count: 1,
  });
}

async function expectPendingOrderInDb(
  db: DbClient,
  pendingOrder: PendingOrderFixture,
): Promise<void> {
  const rows = await selectRows<{
    draw_status: string;
    payment_status: string | null;
    star_status: string;
  }>(
    db,
    `
select d.status as draw_status, d.payment_status, so.status as star_status
from gacha.draw_orders d
join payments.star_orders so on so.id = d.payment_star_order_id
where d.id = ${sqlUuid(pendingOrder.drawOrderId)}
  and so.id = ${sqlUuid(pendingOrder.starOrderId)}
`,
  );

  expect(rows).toEqual([
    {
      draw_status: "invoice_created",
      payment_status: "pending",
      star_status: "invoice_created",
    },
  ]);
}

async function expectWalletVerified(
  db: DbClient,
  userId: string,
): Promise<void> {
  const rows = await selectRows<{
    status: string;
    verified: boolean;
    proof_count: number;
  }>(
    db,
    `
select
  w.status,
  (w.verified_at is not null) as verified,
  (
    select count(*)::integer
    from core.wallet_proofs wp
    where wp.user_id = w.user_id
      and wp.status = 'verified'
      and wp.used_at is not null
  ) as proof_count
from core.user_wallets w
where w.user_id = ${sqlUuid(userId)}
  and w.address = ${sqlString(RAW_WALLET_ADDRESS)}
order by w.updated_at desc
limit 1
`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: "connected",
    verified: true,
  });
  expect(rows[0]?.proof_count).toBeGreaterThanOrEqual(1);
}

async function expectMintQueued(db: DbClient, userId: string): Promise<void> {
  const rows = await selectRows<{
    queue_count: number;
    queued_count: number;
    locked_count: number;
    item_minting_count: number;
  }>(
    db,
    `
select
  count(mq.id)::integer as queue_count,
  count(*) filter (where mq.status = 'queued')::integer as queued_count,
  count(il.id) filter (where il.status = 'active' and il.lock_type = 'mint')::integer as locked_count,
  count(ii.id) filter (where ii.status = 'minting' and ii.nft_mint_status = 'queued')::integer as item_minting_count
from onchain.mint_queue mq
join inventory.item_instances ii on ii.id = mq.item_instance_id
left join inventory.inventory_locks il on il.source_id = mq.id
where mq.user_id = ${sqlUuid(userId)}
`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]?.queue_count).toBeGreaterThanOrEqual(1);
  expect(rows[0]?.queued_count).toBeGreaterThanOrEqual(1);
  expect(rows[0]?.locked_count).toBeGreaterThanOrEqual(1);
  expect(rows[0]?.item_minting_count).toBeGreaterThanOrEqual(1);
}

function createPhase5DbClient(): DbClient {
  const supabaseUrl = requireLocalSupabaseUrl(
    process.env.PHASE5_REAL_E2E_SUPABASE_URL,
  );

  return {
    supabaseUrl,
    containerName: resolveLocalSupabaseDbContainerName(),
  };
}

async function executeSql(db: DbClient, sql: string): Promise<void> {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      db.containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  assertSuccessfulProcess("docker exec psql", result);
}

async function selectRows<T>(db: DbClient, sql: string): Promise<T[]> {
  const wrappedSql = `
select coalesce(jsonb_agg(to_jsonb(phase5_real_e2e_rows)), '[]'::jsonb)::text
from (
${sql}
) as phase5_real_e2e_rows;
`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      db.containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    {
      input: wrappedSql,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  assertSuccessfulProcess("docker exec psql", result);

  return JSON.parse(result.stdout.trim() || "[]") as T[];
}

function resolveLocalSupabaseDbContainerName(): string {
  const configured = process.env.PHASE5_REAL_E2E_DB_CONTAINER?.trim();
  const result = spawnSync("docker", ["ps", "--format", "{{.Names}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  assertSuccessfulProcess("docker ps", result);

  const names = result.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (configured) {
    if (!names.includes(configured)) {
      throw new Error(
        `Configured PHASE5_REAL_E2E_DB_CONTAINER was not found: ${configured}`,
      );
    }

    return configured;
  }

  const candidates = names.filter((name) => name.startsWith("supabase_db_"));
  const projectName = normalizeContainerNamePart(basename(process.cwd()));
  const projectMatches = candidates.filter((name) =>
    normalizeContainerNamePart(name).includes(projectName),
  );

  if (projectMatches.length === 1) {
    return projectMatches[0] as string;
  }

  if (candidates.length === 1) {
    return candidates[0] as string;
  }

  throw new Error(
    `Unable to choose a local Supabase DB container. Set PHASE5_REAL_E2E_DB_CONTAINER. Candidates: ${candidates.join(", ") || "(none)"}`,
  );
}

function assertSuccessfulProcess(
  command: string,
  result: SpawnSyncReturns<string>,
): void {
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} exited with ${result.status ?? "unknown"}:\n${result.stderr || result.stdout}`,
    );
  }
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("PHASE5_REAL_E2E_SUPABASE_URL is required.");
  }

  const url = new URL(value);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(
      `Refusing to run Phase 5 real E2E tests against non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
}

function createRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createTelegramUserId(): number {
  return 9_200_000_000 + Math.floor(Math.random() * 100_000_000);
}

function createTelegramInitData(user: {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
}): string {
  const params = new URLSearchParams({
    auth_date: Math.floor(Date.now() / 1000).toString(),
    query_id: `phase5-real-${randomUUID()}`,
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);

  return params.toString();
}

function normalizeContainerNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sqlUuid(value: string): string {
  return `${sqlString(value)}::uuid`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
