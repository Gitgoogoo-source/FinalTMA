import type { Page, Route } from "@playwright/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOX_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const STAR_ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_TEMPLATE_ID = "55555555-5555-4555-8555-555555555556";
const ITEM_INSTANCE_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_INSTANCE_ID_2 = "66666666-6666-4666-8666-666666666667";
const ITEM_INSTANCE_ID_3 = "66666666-6666-4666-8666-666666666668";
const EVOLVED_ITEM_INSTANCE_ID = "66666666-6666-4666-8666-666666666669";
const TARGET_FORM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const WALLET_ADDRESS = "EQE2EWALLET0000000000000000000000000000000001";
const WALLET_RAW_ADDRESS =
  "0:e2e000000000000000000000000000000000000000000000000000000000000001";
const MINT_QUEUE_ID = "99999999-9999-4999-8999-999999999991";
const NFT_ITEM_ADDRESS = "EQE2ENFTITEM0000000000000000000000000000000001";

export const TEST_INIT_DATA =
  "auth_date=1779321600&query_id=e2e-query&user=%7B%22id%22%3A7001%2C%22first_name%22%3A%22%E6%B5%8B%E8%AF%95%22%7D&hash=e2e";

type MockFirstPhaseApiOptions = {
  boxPaymentFlow?: "dev_completed" | "stars_pending";
  boxPaymentStatus?:
    | "invoice_created"
    | "paid"
    | "fulfilling"
    | "fulfilled"
    | "expired";
  evolveOutcome?: "success" | "failed";
  mintQueueStatus?: WalletMintQueueStatus | null;
  walletStatus?: WalletConnectionStatus;
};

type WalletConnectionStatus =
  | "not_connected"
  | "connected_unverified"
  | "verified"
  | "invalid_proof"
  | "expired_proof"
  | "disconnected";

type WalletMintQueueStatus =
  | "queued"
  | "processing"
  | "submitted"
  | "confirming"
  | "retrying"
  | "manual_review"
  | "minted"
  | "failed"
  | "cancelled";

type InventoryItemPayload = ReturnType<typeof inventoryItemPayload>;

export async function mockFirstPhaseApi(
  page: Page,
  options: MockFirstPhaseApiOptions = {},
): Promise<void> {
  const evolveOutcome = options.evolveOutcome ?? "success";
  const boxPaymentFlow = options.boxPaymentFlow ?? "dev_completed";
  const boxPaymentStatus = options.boxPaymentStatus ?? "invoice_created";
  const walletStatus = options.walletStatus ?? "not_connected";
  let mintQueueStatus = options.mintQueueStatus ?? null;
  let inventoryLevel = 1;
  let inventoryPower = 10;
  let fgemsAvailable = 80;
  let kcoinAvailable = 1200;
  let inventoryEvolved = false;
  let lastBoxDrawCount: 1 | 10 = 1;
  const consumedItemIds = new Set<string>();
  const decomposedItemIds = new Set<string>();

  await page.route("https://config.ton.org/wallets-v2.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );

  await page.route("**/api/auth/telegram", (route) =>
    fulfillOk(route, {
      status: "ok",
      isNewUser: false,
      user: {
        id: USER_ID,
        telegramUserId: "7001",
        username: "tester",
        firstName: "测试",
        lastName: "玩家",
        languageCode: "zh-hans",
        avatarUrl: null,
        inviteCode: "invite_e2e",
      },
      session: {
        sessionId: "session-e2e",
        expiresAt: "2026-05-28T00:00:00.000Z",
        expiresInSeconds: 604800,
        cookieBased: true,
      },
    }),
  );

  await page.route("**/api/me/bootstrap", (route) =>
    fulfillOk(route, {
      profile: {
        id: USER_ID,
        telegram_user_id: "7001",
        username: "tester",
        display_name: "测试玩家",
        avatar_url: null,
      },
      balances: {
        KCOIN: {
          available: String(kcoinAvailable),
          currencyCode: "KCOIN",
          currency_code: "KCOIN",
          locked: "0",
        },
        FGEMS: {
          available: String(fgemsAvailable),
          currencyCode: "FGEMS",
          currency_code: "FGEMS",
          locked: "0",
        },
        STAR_DISPLAY: {
          available: "30",
          currencyCode: "STAR_DISPLAY",
          currency_code: "STAR_DISPLAY",
          locked: "0",
        },
      },
      feature_flags: {
        "gacha.open_box": true,
      },
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/me/assets", (route) =>
    fulfillOk(route, {
      profile: {
        id: USER_ID,
        telegram_user_id: "7001",
        username: "tester",
        display_name: "测试玩家",
        avatar_url: null,
      },
      balances: {
        KCOIN: {
          available: String(kcoinAvailable),
          currencyCode: "KCOIN",
          currency_code: "KCOIN",
          locked: "0",
        },
        FGEMS: {
          available: String(fgemsAvailable),
          currencyCode: "FGEMS",
          currency_code: "FGEMS",
          locked: "0",
        },
        STAR_DISPLAY: {
          available: "30",
          currencyCode: "STAR_DISPLAY",
          currency_code: "STAR_DISPLAY",
          locked: "0",
        },
      },
      updated_at: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/vip/status", (route) =>
    fulfillOk(route, {
      is_vip: false,
      subscription_id: null,
      current_period_end: null,
      today_claimed: false,
      plan: {
        id: "abababab-abab-4aba-8aba-abababababab",
        code: "vip_monthly",
        display_name: "VIP 月卡",
        price_xtr: 199,
        duration_days: 30,
        daily_fgems: 100,
        daily_free_box_count: 1,
        fee_rebate_bps: 2000,
      },
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/wallet/status", (route) =>
    fulfillOk(route, walletStatusPayload(walletStatus, mintQueueStatus)),
  );

  await page.route("**/api/wallet/challenge", (route) =>
    fulfillOk(route, {
      challenge: "e2e-ton-proof-challenge",
      ton_proof_payload: "e2e-ton-proof-challenge",
      expires_at: "2099-05-21T00:05:00.000Z",
    }),
  );

  await page.route("**/api/wallet/connect", (route) => {
    const body = readWalletMutationBody(route, "wallet/connect");

    assert(
      typeof body.address === "string" && body.address.length > 0,
      "wallet/connect request body must include a public address.",
    );
    return fulfillOk(route, walletStatusPayload("connected_unverified", null));
  });

  await page.route("**/api/wallet/proof", (route) => {
    const body = readWalletMutationBody(route, "wallet/proof");

    assert(isRecord(body.account), "wallet/proof must include account.");
    assert(isRecord(body.proof), "wallet/proof must include proof.");
    return fulfillOk(route, walletStatusPayload("verified", mintQueueStatus));
  });

  await page.route("**/api/wallet/disconnect", (route) => {
    readWalletMutationBody(route, "wallet/disconnect");
    return fulfillOk(route, walletStatusPayload("disconnected", null));
  });

  await page.route("**/api/wallet/sync-nfts", (route) => {
    readWalletMutationBody(route, "wallet/sync-nfts");
    return fulfillOk(route, {
      status: "queued",
      job_id: "wallet-sync-e2e",
      last_sync_at: null,
      message: "钱包 NFT 同步已排队。",
      synced_count: 0,
      linked_count: 0,
      ignored_count: 0,
    });
  });

  await page.route("**/api/wallet/nfts?*", (route) =>
    fulfillOk(route, walletNftsPayload(mintQueueStatus)),
  );

  await page.route("**/api/wallet/mint", (route) => {
    const body = readWalletMutationBody(route, "wallet/mint");

    assert(
      body.item_instance_id === ITEM_INSTANCE_ID,
      "wallet/mint request body must include the selected item_instance_id.",
    );
    assert(
      body.target_address === undefined,
      "wallet/mint request body must not include a client-supplied target_address unless explicitly selected.",
    );

    mintQueueStatus = "queued";

    return fulfillOk(route, {
      accepted: true,
      mint_queue_id: MINT_QUEUE_ID,
      status: mintQueueStatus,
      item_instance_id: ITEM_INSTANCE_ID,
      metadata_url: "https://example.test/nft-metadata/e2e.json",
      idempotent: false,
    });
  });

  await page.route("**/api/wallet/mint-status", (route) =>
    fulfillOk(route, walletMintQueuePayload(mintQueueStatus)),
  );

  await page.route("**/api/market/my-listing-stats", (route) =>
    fulfillOk(route, {
      active_count: 0,
      active_listing_count: 0,
      active_item_count: 0,
      total_listing_value_kcoin: 0,
      expected_net_amount_kcoin: 0,
      sold_24h_count: 0,
      sold_24h_value_kcoin: 0,
    }),
  );

  await page.route("**/api/boxes/list?*", (route) =>
    fulfillOk(route, {
      items: [boxPayload()],
      next_cursor: null,
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/boxes/rewards?*", (route) =>
    fulfillOk(route, {
      box_id: BOX_ID,
      box_name: "测试盲盒",
      box_status: "active",
      pool_version_id: "77777777-7777-4777-8777-777777777777",
      pool_version: 1,
      items: [
        {
          pool_item_id: "88888888-8888-4888-8888-888888888888",
          template_id: TEMPLATE_ID,
          name: "森林幼芽",
          rarity: "common",
          rarity_label: "普通",
          item_type: "character",
          item_type_label: "角色",
          display_probability: "100%",
          probability_bps: 10000,
          is_limited: false,
          is_pity_eligible: false,
        },
      ],
      pity_rule: {
        threshold: 3,
        target_rarity: "epic",
        description: "3 抽内必出史诗",
      },
      generated_at: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/boxes/create-open-order", async (route) => {
    const body = readJsonObjectBody(route, "boxes/create-open-order");
    const headerIdempotencyKey = route.request().headers()["x-idempotency-key"];
    const drawCount = body?.draw_count === 10 ? 10 : 1;
    const expectedPriceStars = drawCount === 10 ? 90 : 10;
    lastBoxDrawCount = drawCount;

    assertValidIdempotencyKey(
      headerIdempotencyKey,
      "boxes/create-open-order X-Idempotency-Key",
    );
    assertValidIdempotencyKey(
      body.idempotency_key,
      "boxes/create-open-order body idempotency_key",
    );
    assert(
      headerIdempotencyKey === body.idempotency_key,
      "boxes/create-open-order X-Idempotency-Key must match body idempotency_key.",
    );
    assert(
      body.expected_price_stars === expectedPriceStars,
      "boxes/create-open-order request body must include expected_price_stars from the selected draw option.",
    );
    assert(
      body.user_id === undefined,
      "boxes/create-open-order request body must not include user_id.",
    );
    assert(
      body.telegram_user_id === undefined,
      "boxes/create-open-order request body must not include telegram_user_id.",
    );

    if (boxPaymentFlow === "stars_pending") {
      await fulfillOk(route, {
        order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_payload: `gacha:${ORDER_ID}`,
        invoice_link: "https://t.me/invoice/e2e-open-order",
        invoice_open_mode: "web_app_open_invoice",
        xtr_amount: drawCount === 10 ? 90 : 10,
        draw_count: drawCount,
        order_status: "invoice_created",
        payment_status: "invoice_created",
        payment_order_status: "invoice_created",
        expires_at: "2099-05-21T00:15:00.000Z",
        dev_payment_processed: false,
        idempotent: false,
        result_ready: false,
      });
      return;
    }

    await fulfillOk(route, {
      order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: `gacha:${ORDER_ID}`,
      xtr_amount: drawCount === 10 ? 90 : 10,
      draw_count: drawCount,
      order_status: "completed",
      payment_status: "dev_paid",
      dev_payment_processed: true,
      idempotent: false,
      result_ready: true,
    });
  });

  await page.route("**/api/boxes/result?*", (route) =>
    fulfillOk(
      route,
      boxPaymentFlow === "stars_pending"
        ? starsPaymentResultPayload(boxPaymentStatus, lastBoxDrawCount)
        : {
            order_id: ORDER_ID,
            status: "completed",
            order_status: "completed",
            quantity: 1,
            paid_stars: 10,
            returned_kcoin: 0,
            paid_at: "2026-05-21T00:00:00.000Z",
            completed_at: "2026-05-21T00:00:01.000Z",
            box: {
              display_name: "测试盲盒",
            },
            payment: {
              status: "dev_paid",
            },
            balances: {
              kcoin: {
                available: "1200",
              },
            },
            results: [inventoryItemResult()],
            server_time: "2026-05-21T00:00:01.000Z",
          },
    ),
  );

  await page.route("**/api/inventory/list?*", (route) => {
    const items = getInventoryItems({
      inventoryEvolved,
      inventoryLevel,
      inventoryPower,
      mintStatus: mintQueueStatus,
    }).filter(
      (item) =>
        !consumedItemIds.has(item.item_instance_id) &&
        !decomposedItemIds.has(item.item_instance_id),
    );

    return fulfillOk(route, {
      items,
      total: items.length,
      limit: 40,
      offset: 0,
      next_cursor: null,
      statuses: ["available"],
      server_time: "2026-05-21T00:00:00.000Z",
    });
  });

  await page.route("**/api/inventory/summary?*", (route) => {
    const items = getInventoryItems({
      inventoryEvolved,
      inventoryLevel,
      inventoryPower,
      mintStatus: mintQueueStatus,
    }).filter(
      (item) =>
        !consumedItemIds.has(item.item_instance_id) &&
        !decomposedItemIds.has(item.item_instance_id),
    );
    const groups = buildInventorySummaryGroups(items);

    return fulfillOk(route, {
      groups,
      items,
      total: items.length,
      group_total: groups.length,
      summary: {
        available_count: items.filter((item) => item.status === "available")
          .length,
        group_count: groups.length,
        listed_count: items.filter((item) => item.status === "listed").length,
        locked_count: items.filter((item) => item.status === "locked").length,
        minted_count: items.filter((item) => item.status === "minted").length,
        minting_count: items.filter((item) => item.status === "minting").length,
        total_count: items.length,
      },
      statuses: ["available"],
      server_time: "2026-05-21T00:00:00.000Z",
    });
  });

  await page.route("**/api/inventory/detail?*", (route) => {
    const requestedItemId = new URL(route.request().url()).searchParams.get(
      "item_instance_id",
    );
    const availableItems = getInventoryItems({
      inventoryEvolved,
      inventoryLevel,
      inventoryPower,
      mintStatus: mintQueueStatus,
    }).filter(
      (item) =>
        !consumedItemIds.has(item.item_instance_id) &&
        !decomposedItemIds.has(item.item_instance_id),
    );
    const item =
      availableItems.find(
        (candidate) => candidate.item_instance_id === requestedItemId,
      ) ??
      availableItems[0] ??
      inventoryItemPayload({
        level: inventoryLevel,
        mintStatus: mintQueueStatus,
        power: inventoryPower,
      });

    return fulfillOk(
      route,
      inventoryDetailPayload({
        availableItems,
        fgemsAvailable,
        inventoryEvolved,
        item,
        kcoinAvailable,
        mintStatus: mintQueueStatus,
      }),
    );
  });

  await page.route("**/api/inventory/upgrade", (route) => {
    const body = readGrowthMutationBody(route, "inventory/upgrade");

    assert(
      body.item_instance_id === ITEM_INSTANCE_ID,
      "inventory/upgrade request body must include the selected item_instance_id.",
    );
    assert(
      body.expected_fgems_cost === 70,
      "inventory/upgrade request body must include expected_fgems_cost from the preview.",
    );

    inventoryLevel += 1;
    inventoryPower += 5;
    const balanceBefore = fgemsAvailable;
    fgemsAvailable -= 70;

    return fulfillOk(route, {
      item_instance_id: ITEM_INSTANCE_ID,
      from_level: inventoryLevel - 1,
      to_level: inventoryLevel,
      from_power: inventoryPower - 5,
      to_power: inventoryPower,
      consumed_fgems: 70,
      cost_fgems: 70,
      fgems_balance_before: balanceBefore,
      fgems_balance_after: fgemsAvailable,
      balance_delta: -70,
      ledger_id: "77777777-7777-4777-8777-777777777778",
      upgraded_at: "2026-05-21T00:00:02.000Z",
      idempotent: false,
    });
  });

  await page.route("**/api/inventory/evolve", async (route) => {
    const body = readGrowthMutationBody(route, "inventory/evolve");

    assertStringArray(
      body.source_item_instance_ids,
      "inventory/evolve source_item_instance_ids",
    );
    assertSameStringSet(
      body.source_item_instance_ids,
      [ITEM_INSTANCE_ID, ITEM_INSTANCE_ID_2, ITEM_INSTANCE_ID_3],
      "inventory/evolve source_item_instance_ids",
    );
    const sourceIds = body.source_item_instance_ids;
    const balanceBefore = kcoinAvailable;

    kcoinAvailable -= 200;

    if (evolveOutcome === "success") {
      inventoryEvolved = true;

      return fulfillOk(route, {
        result: "success",
        success: true,
        attempt_id: "77777777-7777-4777-8777-777777777779",
        source_item_instance_ids: sourceIds,
        consumed_item_instance_ids: sourceIds,
        returned_item_instance_id: null,
        created_item_instance_id: EVOLVED_ITEM_INSTANCE_ID,
        main_item_instance_id: ITEM_INSTANCE_ID_3,
        consumed_kcoin: 200,
        cost_kcoin: 200,
        kcoin_balance_before: balanceBefore,
        kcoin_balance_after: kcoinAvailable,
        balance_change: -200,
        ledger_id: "77777777-7777-4777-8777-777777777780",
        success_rate_bps: 5000,
        random_roll_bps: 2500,
        evolved_at: "2026-05-21T00:00:03.000Z",
        idempotent: false,
      });
    }

    for (const itemInstanceId of sourceIds) {
      if (itemInstanceId !== ITEM_INSTANCE_ID_3) {
        consumedItemIds.add(itemInstanceId);
      }
    }

    await fulfillOk(route, {
      result: "failed",
      success: false,
      attempt_id: "77777777-7777-4777-8777-777777777779",
      source_item_instance_ids: sourceIds,
      consumed_item_instance_ids: sourceIds.filter(
        (itemInstanceId) => itemInstanceId !== ITEM_INSTANCE_ID_3,
      ),
      returned_item_instance_id: ITEM_INSTANCE_ID_3,
      created_item_instance_id: null,
      main_item_instance_id: ITEM_INSTANCE_ID_3,
      consumed_kcoin: 200,
      cost_kcoin: 200,
      kcoin_balance_before: balanceBefore,
      kcoin_balance_after: kcoinAvailable,
      balance_change: -200,
      ledger_id: "77777777-7777-4777-8777-777777777780",
      success_rate_bps: 5000,
      random_roll_bps: 7500,
      evolved_at: "2026-05-21T00:00:03.000Z",
      idempotent: false,
    });
  });

  await page.route("**/api/inventory/decompose", async (route) => {
    const body = readGrowthMutationBody(route, "inventory/decompose");

    assertStringArray(
      body.item_instance_ids,
      "inventory/decompose item_instance_ids",
    );
    assertSameStringSet(
      body.item_instance_ids,
      [ITEM_INSTANCE_ID],
      "inventory/decompose item_instance_ids",
    );
    assert(
      body.expected_fgems_reward === 150,
      "inventory/decompose request body must include expected_fgems_reward from the preview.",
    );

    const itemInstanceIds = body.item_instance_ids;
    const balanceBefore = fgemsAvailable;
    const gainedFgems = itemInstanceIds.length * 150;

    for (const itemInstanceId of itemInstanceIds) {
      decomposedItemIds.add(itemInstanceId);
    }
    fgemsAvailable += gainedFgems;

    await fulfillOk(route, {
      decomposed_item_instance_ids: itemInstanceIds,
      gained_fgems: gainedFgems,
      total_reward_fgems: gainedFgems,
      fgems_balance_before: balanceBefore,
      fgems_balance_after: fgemsAvailable,
      balance_change: gainedFgems,
      ledger_id: "77777777-7777-4777-8777-777777777781",
      items: itemInstanceIds.map((itemInstanceId) => ({
        item_instance_id: itemInstanceId,
        reward_fgems: 150,
      })),
      decomposed_at: "2026-05-21T00:00:04.000Z",
      idempotent: false,
    });
  });
}

function starsPaymentResultPayload(
  paymentStatus:
    | "invoice_created"
    | "paid"
    | "fulfilling"
    | "fulfilled"
    | "expired",
  drawCount: 1 | 10,
) {
  const paidAt =
    paymentStatus === "paid" ||
    paymentStatus === "fulfilling" ||
    paymentStatus === "fulfilled"
      ? "2026-05-21T00:00:00.000Z"
      : null;
  const orderStatus =
    paymentStatus === "fulfilling"
      ? "processing"
      : paymentStatus === "fulfilled"
        ? "completed"
        : paymentStatus;
  const completedAt =
    paymentStatus === "fulfilled" ? "2026-05-21T00:00:01.000Z" : null;

  return {
    order_id: ORDER_ID,
    status: paymentStatus === "fulfilled" ? "completed" : "pending",
    order_status: orderStatus,
    quantity: drawCount,
    paid_stars: drawCount === 10 ? 90 : 10,
    returned_kcoin: 0,
    invoice_payload: `gacha:${ORDER_ID}`,
    paid_at: paidAt,
    completed_at: completedAt,
    box: {
      display_name: "测试盲盒",
    },
    payment: {
      status: paymentStatus,
      payment_order_status: paymentStatus,
      paid_at: paidAt,
    },
    balances:
      paymentStatus === "fulfilled"
        ? {
            kcoin: {
              available: "1200",
            },
          }
        : null,
    results:
      paymentStatus === "fulfilled"
        ? Array.from({ length: drawCount }, (_, index) =>
            inventoryItemResult(index + 1),
          )
        : [],
    server_time: "2026-05-21T00:00:01.000Z",
  };
}

function getInventoryItems({
  inventoryEvolved,
  inventoryLevel,
  inventoryPower,
  mintStatus,
}: {
  inventoryEvolved: boolean;
  inventoryLevel: number;
  inventoryPower: number;
  mintStatus: WalletMintQueueStatus | null;
}) {
  if (inventoryEvolved) {
    return [
      inventoryItemPayload({
        formDisplayName: "基础形态",
        formId: TARGET_FORM_ID,
        itemInstanceId: EVOLVED_ITEM_INSTANCE_ID,
        level: 1,
        mintStatus,
        name: "森林游侠",
        power: 42,
        serialNo: 4,
        templateId: TARGET_TEMPLATE_ID,
        templateSlug: "forest_ranger",
      }),
    ];
  }

  return [
    inventoryItemPayload({
      level: inventoryLevel,
      mintStatus,
      power: inventoryPower,
    }),
    inventoryItemPayload({
      itemInstanceId: ITEM_INSTANCE_ID_2,
      level: 2,
      mintStatus: null,
      power: 18,
      serialNo: 2,
    }),
    inventoryItemPayload({
      itemInstanceId: ITEM_INSTANCE_ID_3,
      level: 3,
      mintStatus: null,
      power: 26,
      serialNo: 3,
    }),
  ];
}

function buildInventorySummaryGroups(items: InventoryItemPayload[]) {
  const groups = new Map<string, InventoryItemPayload[]>();

  for (const item of items) {
    const key = `template:${item.template_id}:form:${item.form.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return Array.from(groups.entries()).map(([key, groupItems]) => {
    const representative = groupItems[0];

    if (!representative) {
      throw new Error(`inventory summary group ${key} has no items`);
    }

    return {
      available_count: groupItems.filter((item) => item.status === "available")
        .length,
      item_instance_ids: groupItems.map((item) => item.item_instance_id),
      key,
      latest_obtained_at: representative.obtained_at,
      listed_count: groupItems.filter((item) => item.status === "listed")
        .length,
      locked_count: groupItems.filter((item) => item.status === "locked")
        .length,
      max_level: Math.max(...groupItems.map((item) => item.level)),
      max_power: Math.max(...groupItems.map((item) => item.power)),
      minted_count: groupItems.filter((item) => item.status === "minted")
        .length,
      minting_count: groupItems.filter((item) => item.status === "minting")
        .length,
      owned_count: groupItems.length,
      representative_item: representative,
    };
  });
}

function inventoryDetailPayload({
  availableItems,
  fgemsAvailable,
  inventoryEvolved,
  item,
  kcoinAvailable,
  mintStatus,
}: {
  availableItems: InventoryItemPayload[];
  fgemsAvailable: number;
  inventoryEvolved: boolean;
  item: InventoryItemPayload;
  kcoinAvailable: number;
  mintStatus: WalletMintQueueStatus | null;
}) {
  const sameAvailableItems = availableItems
    .filter(
      (candidate) =>
        candidate.status === "available" &&
        candidate.template_id === item.template_id &&
        candidate.form.id === item.form.id,
    )
    .sort(compareInventoryItemsForGrowth);
  const sameItemCount = sameAvailableItems.length;
  const selectedItemIds = sameAvailableItems
    .slice(0, 3)
    .map((candidate) => candidate.item_instance_id);
  const mainReturnItemId = selectedItemIds[0] ?? item.item_instance_id;
  const canUseGrowth = item.status === "available" && !inventoryEvolved;
  const canUpgrade = canUseGrowth && item.upgradeable;
  const canEvolve = canUseGrowth && item.evolvable && sameItemCount >= 3;
  const canDecompose = canUseGrowth && item.decomposable && sameItemCount >= 2;
  const itemMintStatus = item.nft_mint_status ?? mintStatus ?? "not_minted";

  return {
    ...item,
    market_status: {
      is_listed: false,
      listing_id: null,
      unit_price: null,
      currency: null,
    },
    onchain_status: {
      is_minted: itemMintStatus === "minted",
      mint_status: itemMintStatus,
    },
    upgrade_preview: {
      can_upgrade: canUpgrade,
      reason: canUpgrade ? null : "ITEM_NOT_UPGRADEABLE",
      current_level: item.level,
      next_level: item.level + 1,
      target_level: item.level + 1,
      current_power: item.power,
      power_after: item.power + 5,
      fgems_cost: 70,
      user_fgems_balance: fgemsAvailable,
      is_balance_enough: fgemsAvailable >= 70,
    },
    evolution_preview: {
      can_evolve: canEvolve,
      reason: canEvolve ? null : "EVOLVE_ITEM_COUNT_INVALID",
      required_count: 3,
      available_same_items: sameItemCount,
      kcoin_cost: 200,
      user_kcoin_balance: kcoinAvailable,
      is_balance_enough: kcoinAvailable >= 200,
      success_rate_bps: 5000,
      target_template_id: TARGET_TEMPLATE_ID,
      target_form_id: TARGET_FORM_ID,
      target_name: "森林游侠",
      target_image_url: null,
      selected_item_ids: selectedItemIds,
      main_return_item_id: mainReturnItemId,
    },
    decompose_preview: {
      can_decompose: canDecompose,
      reason: canDecompose ? null : "DECOMPOSE_REQUIRES_DUPLICATE",
      fgems_reward: canDecompose ? 150 : null,
      total_reward_fgems: canDecompose ? 150 : null,
      duplicate_count: sameItemCount,
      item_status: item.status,
      item_instance_ids: [item.item_instance_id],
      items: [
        {
          item_instance_id: item.item_instance_id,
          reward_fgems: canDecompose ? 150 : null,
          item_status: item.status,
          can_decompose: canDecompose,
          duplicate_count: sameItemCount,
        },
      ],
    },
    same_item_count: sameItemCount,
    available_same_item_count: sameItemCount,
  };
}

function compareInventoryItemsForGrowth(
  left: InventoryItemPayload,
  right: InventoryItemPayload,
): number {
  if (right.level !== left.level) {
    return right.level - left.level;
  }

  if (right.power !== left.power) {
    return right.power - left.power;
  }

  return left.serial_no - right.serial_no;
}

function boxPayload() {
  return {
    id: BOX_ID,
    slug: "test-box",
    display_name: "测试盲盒",
    description: "第一阶段自动化测试盲盒",
    tier: "normal",
    status: "active",
    single_star_price: 10,
    ten_draw_price: 90,
    discount_rate: 0.9,
    discount_bps: 1000,
    stock_status: "available",
    total_stock: 100,
    remaining_stock: 88,
    pity_progress: {
      rule_id: "99999999-9999-4999-8999-999999999999",
      threshold: 3,
      current_count: 1,
      total_draws: 1,
      remaining_to_guaranteed: 2,
      target_rarity: "epic",
      guaranteed_next: false,
      updated_at: "2026-05-21T00:00:00.000Z",
    },
    is_openable: true,
    disabled_reason: null,
    kcoin_return_per_draw: 0,
    sort_order: 1,
    updated_at: "2026-05-21T00:00:00.000Z",
  };
}

function inventoryItemPayload(
  overrides: {
    formDisplayName?: string;
    formId?: string;
    itemInstanceId?: string;
    level?: number;
    mintStatus?: WalletMintQueueStatus | null;
    name?: string;
    power?: number;
    serialNo?: number;
    templateId?: string;
    templateSlug?: string;
  } = {},
) {
  return {
    item_instance_id: overrides.itemInstanceId ?? ITEM_INSTANCE_ID,
    template_id: overrides.templateId ?? TEMPLATE_ID,
    template_slug: overrides.templateSlug ?? "forest_sproutling",
    name: overrides.name ?? "森林幼芽",
    subtitle: "测试藏品",
    description: "已进入你的库存",
    rarity: {
      code: "COMMON",
      display_name: "普通",
      sort_order: 10,
    },
    series: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "forest_guardians",
      display_name: "森林守护者",
    },
    form: {
      id: overrides.formId ?? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      index: 1,
      display_name: overrides.formDisplayName ?? "基础形态",
    },
    type_code: "CHARACTER",
    serial_no: overrides.serialNo ?? 1,
    level: overrides.level ?? 1,
    power: overrides.power ?? 10,
    status: "available",
    nft_mint_status: overrides.mintStatus ?? "not_minted",
    tradeable: true,
    upgradeable: true,
    evolvable: true,
    decomposable: true,
    nft_mintable: true,
    source_type: "gacha",
    source_id: ORDER_ID,
    obtained_at: "2026-05-21T00:00:01.000Z",
  };
}

function inventoryItemResult(drawIndex = 1) {
  return {
    draw_index: drawIndex,
    reward_source: "random",
    is_pity_hit: false,
    item_instance_id: ITEM_INSTANCE_ID,
    template_id: TEMPLATE_ID,
    template_slug: "forest_sproutling",
    name: "森林幼芽",
    subtitle: "测试藏品",
    description: "已进入你的库存",
    serial_number: 1,
    rarity: "common",
    rarity_label: "普通",
    item_type: "character",
    form_name: "基础形态",
    level: 1,
    power: 10,
  };
}

function walletStatusPayload(
  status: WalletConnectionStatus,
  mintStatus: WalletMintQueueStatus | null,
) {
  const connected = status !== "not_connected" && status !== "disconnected";
  const verified = status === "verified";

  return {
    status,
    wallet: {
      status,
      address: connected ? WALLET_ADDRESS : null,
      raw_address: connected ? WALLET_RAW_ADDRESS : null,
      network: connected ? "testnet" : null,
      wallet_app_name: connected ? "Tonkeeper" : null,
      verified,
      verified_at: verified ? "2026-05-29T08:00:00.000Z" : null,
      last_sync_at: verified ? "2026-05-29T08:05:00.000Z" : null,
      sync_status: verified ? "success" : "idle",
      mint_queue: walletMintQueueSummary(mintStatus),
      error_message:
        status === "invalid_proof"
          ? "钱包 proof 校验失败。"
          : status === "expired_proof"
            ? "钱包 proof 已过期，请重新连接钱包。"
            : null,
    },
    mint_queue: walletMintQueueSummary(mintStatus),
  };
}

function walletMintQueuePayload(status: WalletMintQueueStatus | null) {
  const items = status ? [walletMintQueueItem(status)] : [];

  return {
    items,
    summary: walletMintQueueSummary(status),
    next_cursor: null,
    server_time: "2026-05-29T08:06:00.000Z",
  };
}

function walletMintQueueSummary(status: WalletMintQueueStatus | null) {
  const summary = {
    queued: 0,
    processing: 0,
    submitted: 0,
    confirming: 0,
    retrying: 0,
    minted: 0,
    cancelled: 0,
    failed: 0,
    manual_review: 0,
  };

  if (!status) {
    return summary;
  }

  summary[status] += 1;
  return summary;
}

function walletMintQueueItem(status: WalletMintQueueStatus) {
  const minted = status === "minted";

  return {
    mint_queue_id: MINT_QUEUE_ID,
    item_instance_id: ITEM_INSTANCE_ID,
    status,
    chain: "TESTNET",
    collection_address: "EQE2ECOLLECTION000000000000000000000000000001",
    item_address: minted ? NFT_ITEM_ADDRESS : null,
    target_address: WALLET_ADDRESS,
    transaction_hash:
      status === "submitted" || status === "confirming" || minted
        ? "e2e-mint-transaction-hash"
        : null,
    error_code: status === "failed" ? "TON_MINT_FAILED" : null,
    error_message: status === "failed" ? "测试 Mint 失败。" : null,
    retry_count: status === "retrying" ? 1 : 0,
    created_at: "2026-05-29T08:00:00.000Z",
    updated_at: "2026-05-29T08:06:00.000Z",
    minted_at: minted ? "2026-05-29T08:10:00.000Z" : null,
  };
}

function walletNftsPayload(status: WalletMintQueueStatus | null) {
  if (status !== "minted") {
    return {
      items: [],
      next_cursor: null,
      server_time: "2026-05-29T08:06:00.000Z",
    };
  }

  return {
    items: [
      {
        nft_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91",
        item_address: NFT_ITEM_ADDRESS,
        collection_address: "EQE2ECOLLECTION000000000000000000000000000001",
        owner_address: WALLET_ADDRESS,
        item_index: 1,
        name: "森林幼芽 NFT",
        image_url: null,
        metadata_url: "https://example.test/nft-metadata/e2e.json",
        linked_item_instance_id: ITEM_INSTANCE_ID,
        synced_at: "2026-05-29T08:11:00.000Z",
      },
    ],
    next_cursor: null,
    server_time: "2026-05-29T08:12:00.000Z",
  };
}

function readWalletMutationBody(
  route: Route,
  action: string,
): Record<string, unknown> {
  const body = readJsonObjectBody(route, action);
  const headerIdempotencyKey = route.request().headers()["x-idempotency-key"];
  const bodyIdempotencyKey = body.idempotency_key;

  assertValidIdempotencyKey(
    headerIdempotencyKey,
    `${action} X-Idempotency-Key`,
  );
  assertValidIdempotencyKey(
    bodyIdempotencyKey,
    `${action} body idempotency_key`,
  );
  assert(
    headerIdempotencyKey === bodyIdempotencyKey,
    `${action} X-Idempotency-Key must match body idempotency_key.`,
  );
  assert(
    body.user_id === undefined,
    `${action} request body must not include user_id.`,
  );
  assert(
    body.telegram_user_id === undefined,
    `${action} request body must not include telegram_user_id.`,
  );
  assert(
    body.wallet_address === undefined,
    `${action} request body must not include wallet_address as a trusted fact.`,
  );

  return body;
}

function readGrowthMutationBody(
  route: Route,
  action: string,
): Record<string, unknown> {
  const body = readJsonObjectBody(route, action);
  const headerIdempotencyKey = route.request().headers()["x-idempotency-key"];
  const bodyIdempotencyKey = body.idempotency_key;

  assertValidIdempotencyKey(
    headerIdempotencyKey,
    `${action} X-Idempotency-Key`,
  );
  assertValidIdempotencyKey(
    bodyIdempotencyKey,
    `${action} body idempotency_key`,
  );
  assert(
    headerIdempotencyKey === bodyIdempotencyKey,
    `${action} X-Idempotency-Key must match body idempotency_key.`,
  );
  assert(
    body.user_id === undefined,
    `${action} request body must not include user_id.`,
  );
  assert(
    body.owner_user_id === undefined,
    `${action} request body must not include owner_user_id.`,
  );

  return body;
}

function readJsonObjectBody(
  route: Route,
  action: string,
): Record<string, unknown> {
  let body: unknown;

  try {
    body = route.request().postDataJSON() as unknown;
  } catch (error) {
    throw new Error(
      `${action} request body must be valid JSON. ${formatError(error)}`,
      { cause: error },
    );
  }

  assert(isRecord(body), `${action} request body must be a JSON object.`);

  return body;
}

function assertValidIdempotencyKey(
  value: unknown,
  label: string,
): asserts value is string {
  assert(typeof value === "string", `${label} must be a string.`);
  assert(
    value.length >= 16 && value.length <= 128,
    `${label} must be 16-128 characters.`,
  );
  assert(
    /^[A-Za-z0-9:_-]+$/.test(value),
    `${label} contains unsupported characters.`,
  );
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  assert(
    value.every((item) => typeof item === "string"),
    `${label} must only contain strings.`,
  );
}

function assertSameStringSet(
  actual: string[],
  expected: string[],
  label: string,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  assert(
    actualSet.size === actual.length,
    `${label} must not contain duplicate ids.`,
  );
  assert(
    actualSet.size === expectedSet.size &&
      expected.every((item) => actualSet.has(item)),
    `${label} must contain the expected ids.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fulfillOk(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      success: true,
      data,
    }),
  });
}
