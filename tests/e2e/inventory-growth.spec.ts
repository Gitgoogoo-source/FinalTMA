import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { expect, test, type Page } from "@playwright/test";

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

type Stage3Fixture = {
  runId: string;
  userId: string;
  bookId: string;
  milestoneId: string;
  baseTemplateId: string;
  upgradeItemId: string;
  decomposeItemId: string;
  evolveSuccessItemIds: [string, string, string];
  evolveFailureItemIds: [string, string, string];
};

type CreatedCollectible = {
  templateId: string;
  baseFormId: string;
  evolvedFormId: string;
  slug: string;
  displayName: string;
  successRateBps?: number;
};

type FixtureItem = {
  id: string;
  templateId: string;
  formId: string;
  level: number;
  power: number;
};

type DbClient = {
  supabaseUrl: string;
  containerName: string;
};

const BOT_TOKEN =
  process.env.STAGE3_REAL_E2E_BOT_TOKEN ??
  "123456789:stage3-real-e2e-bot-token";
const CRON_SECRET = "stage3-real-e2e-cron-secret-000001";

test.skip(
  process.env.STAGE3_REAL_E2E !== "1",
  "Stage 3 real E2E requires `pnpm test:e2e:stage3-real`.",
);

test("第十七步真实链路：浏览器会话通过 Vercel API 写入 Supabase", async ({
  page,
}) => {
  const db = createStage3DbClient();
  const runId = createRunId();
  const telegramUserId = createTelegramUserId();
  const initData = createTelegramInitData({
    id: telegramUserId,
    first_name: "Stage3",
    last_name: "RealE2E",
    username: `stage3_real_${runId}`,
  });

  const loginResponse = await page.request.post("/api/auth/telegram", {
    data: {
      initData,
      clientContext: {
        platform: "stage3-real-e2e",
      },
    },
  });
  const loginBody = await loginResponse.json();

  expect(loginResponse.ok(), JSON.stringify(loginBody)).toBe(true);
  expect(loginBody.ok).toBe(true);

  const userId = loginBody.data.user.id as string;
  const fixture = await seedStage3Fixture(db, {
    runId,
    userId,
  });

  await page.goto(`/collection?mockInitData=${encodeURIComponent(initData)}`);
  await expect(page.getByTestId("collection-page")).toBeVisible();
  await expect(page.getByText(`真实链路基础 ${runId}`).first()).toBeVisible();

  const upgradeKey = `stage3-real:${runId}:upgrade`;
  const upgradeResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/inventory/upgrade",
    {
      item_instance_id: fixture.upgradeItemId,
      idempotency_key: upgradeKey,
    },
    upgradeKey,
  );

  expect(upgradeResult.item_instance_id).toBe(fixture.upgradeItemId);
  expect(upgradeResult.to_level).toBe(2);
  await expectItem(db, fixture.upgradeItemId, {
    owner_user_id: userId,
    status: "available",
    level: 2,
  });
  await expectTableCount(db, "inventory", "upgrade_logs", upgradeKey, 1);

  const evolveSuccessKey = `stage3-real:${runId}:evolve-success`;
  const evolveSuccess = await apiPost<Record<string, unknown>>(
    page,
    "/api/inventory/evolve",
    {
      source_item_instance_ids: fixture.evolveSuccessItemIds,
      idempotency_key: evolveSuccessKey,
    },
    evolveSuccessKey,
  );

  expect(evolveSuccess.success).toBe(true);
  expect(evolveSuccess.created_item_instance_id).toBeTruthy();
  await expectItemsHaveStatus(db, fixture.evolveSuccessItemIds, "consumed");
  await expectTableCount(
    db,
    "inventory",
    "evolution_attempts",
    evolveSuccessKey,
    1,
  );

  const evolveFailureKey = `stage3-real:${runId}:evolve-failure`;
  const evolveFailure = await apiPost<Record<string, unknown>>(
    page,
    "/api/inventory/evolve",
    {
      source_item_instance_ids: fixture.evolveFailureItemIds,
      expected_return_item_instance_id: fixture.evolveFailureItemIds[2],
      idempotency_key: evolveFailureKey,
    },
    evolveFailureKey,
  );

  expect(evolveFailure.success).toBe(false);
  expect(evolveFailure.created_item_instance_id).toBeNull();
  expect(evolveFailure.returned_item_instance_id).toBe(
    fixture.evolveFailureItemIds[2],
  );
  await expectItem(db, fixture.evolveFailureItemIds[2], {
    owner_user_id: userId,
    status: "available",
  });
  await expectItemsHaveStatus(
    db,
    [fixture.evolveFailureItemIds[0], fixture.evolveFailureItemIds[1]],
    "consumed",
  );
  await expectTableCount(
    db,
    "inventory",
    "evolution_attempts",
    evolveFailureKey,
    1,
  );

  const decomposeKey = `stage3-real:${runId}:decompose`;
  const decomposeResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/inventory/decompose",
    {
      item_instance_ids: [fixture.decomposeItemId],
      idempotency_key: decomposeKey,
    },
    decomposeKey,
  );

  expect(decomposeResult.decomposed_item_instance_ids).toContain(
    fixture.decomposeItemId,
  );
  await expectItem(db, fixture.decomposeItemId, {
    owner_user_id: null,
    status: "decomposed",
  });
  await expectTableCount(db, "inventory", "decompose_logs", decomposeKey, 1);

  const progress = await apiGet<Record<string, unknown>>(
    page,
    `/api/album/progress?book_id=${fixture.bookId}&include_items=true&include_milestones=true&include_rewards=true`,
  );
  const progressBook = progress.book as Record<string, unknown>;

  expect(progressBook.collected_count).toBe(1);
  expect(progressBook.total_count).toBe(1);
  await expectDiscovery(db, userId, fixture.baseTemplateId, 1);

  const claimKey = `stage3-real:${runId}:claim`;
  const claimResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/album/claim-reward",
    {
      milestone_id: fixture.milestoneId,
      book_id: fixture.bookId,
      expected_milestone_version: 0,
      idempotency_key: claimKey,
    },
    claimKey,
  );

  expect(claimResult.status).toBe("claimed");
  await expectTableCount(db, "album", "milestone_claims", claimKey, 1);

  const repeatClaim = await apiPost<Record<string, unknown>>(
    page,
    "/api/album/claim-reward",
    {
      milestone_id: fixture.milestoneId,
      book_id: fixture.bookId,
      expected_milestone_version: 0,
      idempotency_key: claimKey,
    },
    claimKey,
  );

  expect(repeatClaim.status).toBe("claimed");
  await expectTableCount(db, "album", "milestone_claims", claimKey, 1);

  const refreshResult = await apiPost<Record<string, unknown>>(
    page,
    "/api/cron/refresh-leaderboard",
    {},
    null,
    {
      authorization: `Bearer ${CRON_SECRET}`,
    },
  );

  expect(refreshResult.entry_count).toBeGreaterThan(0);

  const leaderboard = await apiGet<Record<string, unknown>>(
    page,
    "/api/album/leaderboard?period=current_week&scope=global&sort=score_desc&limit=50",
  );
  const myEntry = leaderboard.my_entry as Record<string, unknown> | null;

  expect(myEntry?.user_id).toBe(userId);
  expect(Number(myEntry?.score)).toBeGreaterThan(0);
});

async function seedStage3Fixture(
  db: DbClient,
  input: { runId: string; userId: string },
): Promise<Stage3Fixture> {
  const seriesId = randomUUID();
  const bookId = randomUUID();
  const milestoneId = randomUUID();
  const base = createCollectible({
    runId: input.runId,
    slugPrefix: "base",
    displayName: `真实链路基础 ${input.runId}`,
  });
  const evolveSuccess = createCollectible({
    runId: input.runId,
    slugPrefix: "success",
    displayName: `真实链路成功 ${input.runId}`,
    successRateBps: 10_000,
  });
  const evolveFailure = createCollectible({
    runId: input.runId,
    slugPrefix: "failure",
    displayName: `真实链路失败 ${input.runId}`,
    successRateBps: 0,
  });
  const upgradeItemId = randomUUID();
  const decomposeItemId = randomUUID();
  const duplicateKeepItemId = randomUUID();
  const evolveSuccessItemIds = [randomUUID(), randomUUID(), randomUUID()] as [
    string,
    string,
    string,
  ];
  const evolveFailureItemIds = [randomUUID(), randomUUID(), randomUUID()] as [
    string,
    string,
    string,
  ];
  const items: FixtureItem[] = [
    buildItem(upgradeItemId, base, 1, 10),
    buildItem(decomposeItemId, base, 1, 10),
    buildItem(duplicateKeepItemId, base, 1, 10),
    buildItem(evolveSuccessItemIds[0], evolveSuccess, 1, 10),
    buildItem(evolveSuccessItemIds[1], evolveSuccess, 1, 10),
    buildItem(evolveSuccessItemIds[2], evolveSuccess, 1, 10),
    buildItem(evolveFailureItemIds[0], evolveFailure, 1, 10),
    buildItem(evolveFailureItemIds[1], evolveFailure, 2, 18),
    buildItem(evolveFailureItemIds[2], evolveFailure, 3, 26),
  ];

  await executeSql(
    db,
    buildStage3FixtureSql({
      runId: input.runId,
      userId: input.userId,
      seriesId,
      bookId,
      milestoneId,
      base,
      evolveSuccess,
      evolveFailure,
      upgradeItemId,
      items,
    }),
  );

  return {
    runId: input.runId,
    userId: input.userId,
    bookId,
    milestoneId,
    baseTemplateId: base.templateId,
    upgradeItemId,
    decomposeItemId,
    evolveSuccessItemIds,
    evolveFailureItemIds,
  };
}

function createCollectible(input: {
  runId: string;
  slugPrefix: string;
  displayName: string;
  successRateBps?: number;
}): CreatedCollectible {
  const collectible: CreatedCollectible = {
    templateId: randomUUID(),
    baseFormId: randomUUID(),
    evolvedFormId: randomUUID(),
    slug: `stage3-real-${input.slugPrefix}-${input.runId}`,
    displayName: input.displayName,
  };

  if (input.successRateBps !== undefined) {
    collectible.successRateBps = input.successRateBps;
  }

  return collectible;
}

function buildItem(
  id: string,
  collectible: CreatedCollectible,
  level: number,
  power: number,
): FixtureItem {
  return {
    id,
    templateId: collectible.templateId,
    formId: collectible.baseFormId,
    level,
    power,
  };
}

function buildStage3FixtureSql(input: {
  runId: string;
  userId: string;
  seriesId: string;
  bookId: string;
  milestoneId: string;
  base: CreatedCollectible;
  evolveSuccess: CreatedCollectible;
  evolveFailure: CreatedCollectible;
  upgradeItemId: string;
  items: FixtureItem[];
}): string {
  const metadata = `jsonb_build_object('stage3_real_e2e', true, 'run_id', ${sqlString(input.runId)})`;

  return `
begin;

insert into catalog.series (
  id, slug, display_name, description, status, sort_order, metadata
) values (
  ${sqlUuid(input.seriesId)},
  ${sqlString(`stage3-real-${input.runId}`)},
  ${sqlString(`真实链路系列 ${input.runId}`)},
  'Stage 3 real E2E fixture.',
  'active',
  -10000,
  ${metadata}
);

${collectibleSql(input.base, input.seriesId, input.runId)}
${collectibleSql(input.evolveSuccess, input.seriesId, input.runId)}
${collectibleSql(input.evolveFailure, input.seriesId, input.runId)}

insert into inventory.upgrade_rules (
  rarity_code, form_index, from_level, to_level, cost_fgems, power_gain, active, metadata
) values (
  'COMMON', 1, 1, 2, 5, 7, true, ${metadata}
) on conflict (rarity_code, form_index, from_level, to_level, active) do nothing;

insert into inventory.decompose_rules (
  rarity_code, form_index, min_level, reward_fgems, active, metadata
) values (
  'COMMON', 1, 1, 9, true, ${metadata}
) on conflict (rarity_code, form_index, min_level, active) do nothing;

select api._credit_balance(
  ${sqlUuid(input.userId)},
  'FGEMS',
  1000000,
  'admin',
  null,
  'stage3-real-e2e',
  ${sqlString(`stage3-real:${input.runId}:seed-fgems`)},
  'Stage 3 real E2E fixture balance',
  ${metadata}
);

select api._credit_balance(
  ${sqlUuid(input.userId)},
  'KCOIN',
  1000000,
  'admin',
  null,
  'stage3-real-e2e',
  ${sqlString(`stage3-real:${input.runId}:seed-kcoin`)},
  'Stage 3 real E2E fixture balance',
  ${metadata}
);

insert into inventory.item_instances (
  id, owner_user_id, template_id, form_id, level, power, status, source_type, metadata
) values
${input.items.map((item) => itemSql(item, input.userId, input.runId)).join(",\n")};

insert into inventory.item_instance_events (
  item_instance_id, user_id, event_type, source_type, before_state, after_state, metadata
) values
${input.items.map((item) => itemEventSql(item, input.userId, input.runId)).join(",\n")};

insert into album.user_discoveries (
  user_id, template_id, first_item_instance_id, first_source_type, metadata
) values (
  ${sqlUuid(input.userId)},
  ${sqlUuid(input.base.templateId)},
  ${sqlUuid(input.upgradeItemId)},
  'admin',
  ${metadata}
) on conflict (user_id, template_id) do update
set first_item_instance_id = excluded.first_item_instance_id,
    first_source_type = excluded.first_source_type,
    metadata = album.user_discoveries.metadata || excluded.metadata;

insert into album.books (
  id, code, display_name, description, book_type, active, sort_order, metadata
) values (
  ${sqlUuid(input.bookId)},
  ${sqlString(`stage3-real-${input.runId}`)},
  ${sqlString(`真实链路图鉴 ${input.runId}`)},
  'Stage 3 real E2E book.',
  'all',
  true,
  -10000,
  ${metadata}
);

insert into album.book_items (book_id, template_id, sort_order)
values (${sqlUuid(input.bookId)}, ${sqlUuid(input.base.templateId)}, 1)
on conflict (book_id, template_id) do nothing;

insert into album.milestones (
  id, book_id, required_count, title, reward, active, sort_order, metadata
) values (
  ${sqlUuid(input.milestoneId)},
  ${sqlUuid(input.bookId)},
  1,
  ${sqlString(`真实链路奖励 ${input.runId}`)},
  jsonb_build_array(
    jsonb_build_object(
      'currency', 'FGEMS',
      'reward_type', 'FGEMS',
      'amount', 33,
      'label', '33 FGEMS'
    )
  ),
  true,
  1,
  ${metadata} || jsonb_build_object('version', 0)
);

insert into album.score_rules (id, code, rule_type, points, active, metadata)
values (
  ${sqlUuid(randomUUID())},
  ${sqlString(`stage3-real-discovery-${input.runId}`)},
  'discovery',
  10,
  true,
  ${metadata}
);

commit;
`;
}

function collectibleSql(
  collectible: CreatedCollectible,
  seriesId: string,
  runId: string,
): string {
  const metadata = `jsonb_build_object('stage3_real_e2e', true, 'run_id', ${sqlString(runId)})`;
  const evolutionRule =
    collectible.successRateBps === undefined
      ? ""
      : `
insert into inventory.evolution_rules (
  id,
  from_template_id,
  from_form_id,
  to_template_id,
  to_form_id,
  required_count,
  cost_kcoin,
  success_rate_bps,
  active,
  metadata
) values (
  ${sqlUuid(randomUUID())},
  ${sqlUuid(collectible.templateId)},
  ${sqlUuid(collectible.baseFormId)},
  ${sqlUuid(collectible.templateId)},
  ${sqlUuid(collectible.evolvedFormId)},
  3,
  25,
  ${collectible.successRateBps},
  true,
  ${metadata}
);
`;

  return `
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
  ${sqlUuid(collectible.templateId)},
  ${sqlString(collectible.slug)},
  ${sqlString(collectible.displayName)},
  'Stage 3 real E2E',
  'Created by the Stage 3 real E2E acceptance test.',
  'COMMON',
  'CHARACTER',
  ${sqlUuid(seriesId)},
  10,
  10,
  'active',
  true,
  true,
  true,
  true,
  false,
  -10000,
  ${metadata}
);

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  base_power_bonus,
  is_default,
  metadata
) values
(
  ${sqlUuid(collectible.baseFormId)},
  ${sqlUuid(collectible.templateId)},
  1,
  'base',
  ${sqlString(`${collectible.displayName} 初阶`)},
  0,
  true,
  ${metadata}
),
(
  ${sqlUuid(collectible.evolvedFormId)},
  ${sqlUuid(collectible.templateId)},
  2,
  'evolved',
  ${sqlString(`${collectible.displayName} 进化`)},
  8,
  false,
  ${metadata}
);

update catalog.collectible_forms
set next_form_id = ${sqlUuid(collectible.evolvedFormId)}
where id = ${sqlUuid(collectible.baseFormId)};
${evolutionRule}
`;
}

function itemSql(item: FixtureItem, userId: string, runId: string): string {
  return `(
  ${sqlUuid(item.id)},
  ${sqlUuid(userId)},
  ${sqlUuid(item.templateId)},
  ${sqlUuid(item.formId)},
  ${item.level},
  ${item.power},
  'available',
  'admin',
  jsonb_build_object('stage3_real_e2e', true, 'run_id', ${sqlString(runId)})
)`;
}

function itemEventSql(
  item: FixtureItem,
  userId: string,
  runId: string,
): string {
  return `(
  ${sqlUuid(item.id)},
  ${sqlUuid(userId)},
  'created',
  'admin',
  '{}'::jsonb,
  jsonb_build_object('status', 'available', 'level', ${item.level}, 'power', ${item.power}),
  jsonb_build_object('stage3_real_e2e', true, 'run_id', ${sqlString(runId)})
)`;
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
  headers: Record<string, string> = {},
): Promise<T> {
  return apiRequest<T>(page, path, {
    method: "POST",
    body,
    headers: {
      ...headers,
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    },
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

function createStage3DbClient(): DbClient {
  const supabaseUrl = requireLocalSupabaseUrl(
    process.env.STAGE3_REAL_E2E_SUPABASE_URL,
  );

  return {
    supabaseUrl,
    containerName: resolveLocalSupabaseDbContainerName(),
  };
}

function createRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

function createTelegramUserId(): number {
  return 9_100_000_000 + Math.floor(Math.random() * 100_000_000);
}

function createTelegramInitData(user: {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
}): string {
  const params = new URLSearchParams({
    auth_date: Math.floor(Date.now() / 1000).toString(),
    query_id: `stage3-real-${randomUUID()}`,
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

async function expectItem(
  db: DbClient,
  id: string,
  expected: Record<string, unknown>,
): Promise<void> {
  const rows = await selectRows<Record<string, unknown>>(
    db,
    `
select owner_user_id::text as owner_user_id, status, level
from inventory.item_instances
where id = ${sqlUuid(id)}
`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject(expected);
}

async function expectItemsHaveStatus(
  db: DbClient,
  ids: string[],
  status: string,
): Promise<void> {
  const rows = await selectRows<Record<string, unknown>>(
    db,
    `
select id::text as id, status
from inventory.item_instances
where id in (${ids.map(sqlUuid).join(", ")})
`,
  );

  expect(rows).toHaveLength(ids.length);
  expect(rows.every((row) => row.status === status)).toBe(true);
}

async function expectDiscovery(
  db: DbClient,
  userId: string,
  templateId: string,
  expectedCount: number,
): Promise<void> {
  const rows = await selectRows<{ count: number }>(
    db,
    `
select count(*)::integer as count
from album.user_discoveries
where user_id = ${sqlUuid(userId)}
  and template_id = ${sqlUuid(templateId)}
`,
  );

  expect(rows[0]?.count).toBe(expectedCount);
}

async function expectTableCount(
  db: DbClient,
  schema: string,
  table: string,
  idempotencyKey: string,
  expectedCount: number,
): Promise<void> {
  const rows = await selectRows<{ count: number }>(
    db,
    `
select count(*)::integer as count
from ${sqlIdentifier(schema)}.${sqlIdentifier(table)}
where idempotency_key = ${sqlString(idempotencyKey)}
`,
  );

  expect(rows[0]?.count).toBe(expectedCount);
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
select coalesce(jsonb_agg(to_jsonb(stage3_real_e2e_rows)), '[]'::jsonb)::text
from (
${sql}
) as stage3_real_e2e_rows;
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
  const configured = process.env.STAGE3_REAL_E2E_DB_CONTAINER?.trim();
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
        `Configured STAGE3_REAL_E2E_DB_CONTAINER was not found: ${configured}`,
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
    `Unable to choose a local Supabase DB container. Set STAGE3_REAL_E2E_DB_CONTAINER. Candidates: ${candidates.join(", ") || "(none)"}`,
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
    throw new Error("STAGE3_REAL_E2E_SUPABASE_URL is required.");
  }

  const url = new URL(value);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(
      `Refusing to run Stage 3 real E2E tests against non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
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

function sqlIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }

  return `"${value.replaceAll('"', '""')}"`;
}
