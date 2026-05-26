import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

type DbClient = {
  containerName: string;
};

type Fixture = {
  campaignId: string;
  taskId: string;
  telegramUserId: number;
  userId: string;
};

type WorkerResult = {
  attempt: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type SigninPayload = {
  alreadyClaimed: boolean;
  ledgerResultCount: number;
  signinId: string;
};

type DbSummary = {
  balance: number;
  completedProgressRows: number;
  idempotencyCount: number;
  ledgerCount: number;
  progressCount: number;
  progressRows: number;
  signinCount: number;
  sourceEventCount: number;
};

const CONCURRENT_ATTEMPTS = 10;
const REWARD_AMOUNT = 88;

async function main(): Promise<void> {
  const db = createDbClient();
  const runId = createRunId();
  const signInDate = createShanghaiDate();
  const telegramUserId = createTelegramUserId();
  let fixture: Fixture | null = null;

  try {
    fixture = createFixture(db, runId, telegramUserId);
    const startAt = new Date(Date.now() + 1_500).toISOString();
    const workerResults = await runConcurrentSignins(
      db,
      fixture,
      runId,
      signInDate,
      startAt,
    );
    const payloads = workerResults.map(parseSigninPayload);

    assertPayloads(payloads);

    const summary = readDbSummary(db, fixture, runId, signInDate);
    assertDbSummary(summary);

    console.log(
      `Sign-in concurrency acceptance passed: ${CONCURRENT_ATTEMPTS} connections, 1 signin row, 1 ledger row.`,
    );
  } finally {
    cleanupFixture(db, runId, fixture);
  }
}

function createDbClient(): DbClient {
  return {
    containerName: resolveLocalSupabaseDbContainerName(),
  };
}

function createFixture(
  db: DbClient,
  runId: string,
  telegramUserId: number,
): Fixture {
  const campaignCode = `SIGNIN_CONCURRENCY_${runId}`;
  const taskCode = `SIGNIN_CONCURRENCY_PROGRESS_${runId}`;
  const username = `signin_concurrency_${runId}`;
  const setupSql = `
set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

with user_payload as (
  select api.auth_upsert_telegram_user(
    p_telegram_user_id := ${telegramUserId},
    p_username := ${sqlString(username)},
    p_first_name := 'Signin',
    p_last_name := 'Concurrency',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/${runId}.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'signin_concurrency', 'run_id', ${sqlString(runId)})
  ) as payload
),
user_row as (
  select (payload ->> 'user_id')::uuid as user_id from user_payload
),
campaign_row as (
  insert into tasks.signin_campaigns (
    code,
    title,
    description,
    cycle_days,
    active,
    starts_at,
    ends_at,
    metadata
  )
  values (
    ${sqlString(campaignCode)},
    'Sign-in Concurrency Acceptance',
    '10 independent database connections race the same daily sign-in',
    7,
    true,
    now() - interval '1 day',
    now() + interval '7 days',
    jsonb_build_object('test', true, 'suite', 'signin_concurrency', 'run_id', ${sqlString(runId)})
  )
  on conflict (code) do update
  set active = true,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      cycle_days = excluded.cycle_days,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
),
signin_day_rows as (
  insert into tasks.signin_days (campaign_id, day_index, reward, title, metadata)
  select
    campaign_row.id,
    day_index,
    case
      when day_index = 1 then jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', ${REWARD_AMOUNT}))
      else '[]'::jsonb
    end,
    'Day ' || day_index::text,
    jsonb_build_object('test', true, 'suite', 'signin_concurrency', 'run_id', ${sqlString(runId)})
  from campaign_row
  cross join generate_series(1, 7) as gs(day_index)
  on conflict (campaign_id, day_index) do update
  set reward = excluded.reward,
      title = excluded.title,
      metadata = excluded.metadata
  returning campaign_id
),
task_row as (
  insert into tasks.task_definitions (
    code,
    task_type,
    title,
    description,
    period_type,
    target_count,
    reward,
    action_type,
    active,
    metadata
  )
  values (
    ${sqlString(taskCode)},
    'daily',
    'Sign-in Concurrency Progress Acceptance',
    'Progress row used by the sign-in concurrency acceptance test',
    'daily',
    1,
    '[]'::jsonb,
    'none',
    true,
    jsonb_build_object('progress_source', 'signin_success', 'test', true, 'suite', 'signin_concurrency', 'run_id', ${sqlString(runId)})
  )
  on conflict (code) do update
  set active = true,
      target_count = 1,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
select jsonb_build_object(
  'campaignId', (select id from campaign_row),
  'taskId', (select id from task_row),
  'telegramUserId', ${telegramUserId},
  'userId', (select user_id from user_row)
)::text;
`;

  return parseFixture(runPsqlSync(db, setupSql));
}

async function runConcurrentSignins(
  db: DbClient,
  fixture: Fixture,
  runId: string,
  signInDate: string,
  startAt: string,
): Promise<WorkerResult[]> {
  const workers = Array.from({ length: CONCURRENT_ATTEMPTS }, (_, index) => {
    const attempt = index + 1;
    const idempotencyKey = `signin-concurrency-${runId}-${attempt}`;
    const sql = `
set statement_timeout = '45s';
select pg_sleep(greatest(0.0, extract(epoch from (${sqlString(startAt)}::timestamptz - clock_timestamp())))::double precision);
select api.task_daily_check_in(
  ${sqlUuid(fixture.userId)},
  ${sqlUuid(fixture.campaignId)},
  ${sqlString(signInDate)}::date,
  0,
  ${sqlString(idempotencyKey)}
)::text;
`;

    return runPsqlAsync(db, sql, attempt);
  });

  const results = await Promise.all(workers);
  const failed = results.filter((result) => result.code !== 0);

  if (failed.length > 0) {
    throw new Error(
      `Concurrent sign-in workers failed:\n${failed
        .map(
          (result) =>
            `attempt=${result.attempt} code=${result.code ?? "null"} signal=${result.signal ?? "null"}\n${result.stderr || result.stdout}`,
        )
        .join("\n\n")}`,
    );
  }

  return results;
}

function readDbSummary(
  db: DbClient,
  fixture: Fixture,
  runId: string,
  signInDate: string,
): DbSummary {
  const prefix = `signin-concurrency-${runId}-`;
  const sql = `
set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select jsonb_build_object(
  'balance', coalesce((
    select available_amount
    from economy.user_balances
    where user_id = ${sqlUuid(fixture.userId)}
      and currency_code = 'KCOIN'
  ), 0),
  'completedProgressRows', (
    select count(*)::integer
    from tasks.user_task_progress
    where user_id = ${sqlUuid(fixture.userId)}
      and task_id = ${sqlUuid(fixture.taskId)}
      and period_key = ${sqlString(signInDate)}
      and status = 'completed'
  ),
  'idempotencyCount', (
    select count(*)::integer
    from ops.idempotency_keys
    where key like ${sqlString(`task_daily_check_in:${prefix}%`)}
      and status = 'completed'
  ),
  'ledgerCount', (
    select count(*)::integer
    from economy.currency_ledger
    where user_id = ${sqlUuid(fixture.userId)}
      and source_type = 'daily_check_in'
      and idempotency_key like ${sqlString(`daily_check_in:${prefix}%:%`)}
      and amount = ${REWARD_AMOUNT}
  ),
  'progressCount', coalesce((
    select progress_count
    from tasks.user_task_progress
    where user_id = ${sqlUuid(fixture.userId)}
      and task_id = ${sqlUuid(fixture.taskId)}
      and period_key = ${sqlString(signInDate)}
  ), 0),
  'progressRows', (
    select count(*)::integer
    from tasks.user_task_progress
    where user_id = ${sqlUuid(fixture.userId)}
      and task_id = ${sqlUuid(fixture.taskId)}
      and period_key = ${sqlString(signInDate)}
  ),
  'signinCount', (
    select count(*)::integer
    from tasks.user_signins
    where user_id = ${sqlUuid(fixture.userId)}
      and campaign_id = ${sqlUuid(fixture.campaignId)}
      and signin_date = ${sqlString(signInDate)}::date
  ),
  'sourceEventCount', coalesce((
    select jsonb_array_length(source_events)
    from tasks.user_task_progress
    where user_id = ${sqlUuid(fixture.userId)}
      and task_id = ${sqlUuid(fixture.taskId)}
      and period_key = ${sqlString(signInDate)}
  ), 0)
)::text;
`;

  return parseDbSummary(runPsqlSync(db, sql));
}

function cleanupFixture(
  db: DbClient,
  runId: string,
  fixture: Fixture | null,
): void {
  const cleanupSql = `
set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

update tasks.task_definitions
set active = false,
    updated_at = now()
where code = ${sqlString(`SIGNIN_CONCURRENCY_PROGRESS_${runId}`)};

update tasks.signin_campaigns
set active = false,
    ends_at = least(coalesce(ends_at, now()), now()),
    updated_at = now()
where code = ${sqlString(`SIGNIN_CONCURRENCY_${runId}`)};
`;

  if (!fixture) {
    return;
  }

  try {
    runPsqlSync(db, cleanupSql);
  } catch (error) {
    console.warn(
      `Sign-in concurrency cleanup failed: ${getErrorMessage(error)}`,
    );
  }
}

function parseSigninPayload(result: WorkerResult): SigninPayload {
  const parsed = parseLastJsonLine(result.stdout, `worker ${result.attempt}`);
  const alreadyClaimed = readBoolean(parsed, "already_claimed");
  const signinId = readString(parsed, "signin_id");
  const ledgerResults = readArray(parsed, "ledger_results");

  return {
    alreadyClaimed,
    ledgerResultCount: ledgerResults.length,
    signinId,
  };
}

function parseFixture(stdout: string): Fixture {
  const parsed = parseLastJsonLine(stdout, "fixture setup");

  return {
    campaignId: readString(parsed, "campaignId"),
    taskId: readString(parsed, "taskId"),
    telegramUserId: readNumber(parsed, "telegramUserId"),
    userId: readString(parsed, "userId"),
  };
}

function parseDbSummary(stdout: string): DbSummary {
  const parsed = parseLastJsonLine(stdout, "database summary");

  return {
    balance: readNumber(parsed, "balance"),
    completedProgressRows: readNumber(parsed, "completedProgressRows"),
    idempotencyCount: readNumber(parsed, "idempotencyCount"),
    ledgerCount: readNumber(parsed, "ledgerCount"),
    progressCount: readNumber(parsed, "progressCount"),
    progressRows: readNumber(parsed, "progressRows"),
    signinCount: readNumber(parsed, "signinCount"),
    sourceEventCount: readNumber(parsed, "sourceEventCount"),
  };
}

function assertPayloads(payloads: SigninPayload[]): void {
  if (payloads.length !== CONCURRENT_ATTEMPTS) {
    throw new Error(
      `Expected ${CONCURRENT_ATTEMPTS} payloads, got ${payloads.length}.`,
    );
  }

  const firstClaimCount = payloads.filter(
    (payload) => !payload.alreadyClaimed,
  ).length;
  const alreadyClaimedCount = payloads.filter(
    (payload) => payload.alreadyClaimed,
  ).length;
  const creditedPayloadCount = payloads.filter(
    (payload) => payload.ledgerResultCount === 1,
  ).length;
  const signinIds = new Set(payloads.map((payload) => payload.signinId));

  assertEqual(firstClaimCount, 1, "exactly one concurrent call should claim");
  assertEqual(
    alreadyClaimedCount,
    CONCURRENT_ATTEMPTS - 1,
    "the remaining concurrent calls should return already_claimed",
  );
  assertEqual(
    creditedPayloadCount,
    1,
    "exactly one concurrent response should include a ledger reward",
  );
  assertEqual(
    signinIds.size,
    1,
    "all concurrent responses should point to one signin_id",
  );
}

function assertDbSummary(summary: DbSummary): void {
  assertEqual(
    summary.signinCount,
    1,
    "database should contain one sign-in row",
  );
  assertEqual(
    summary.ledgerCount,
    1,
    "database should contain one reward ledger row",
  );
  assertEqual(
    summary.balance,
    REWARD_AMOUNT,
    "balance should be credited once",
  );
  assertEqual(
    summary.progressRows,
    1,
    "database should contain one progress row",
  );
  assertEqual(
    summary.completedProgressRows,
    1,
    "progress row should be completed",
  );
  assertEqual(
    summary.progressCount,
    1,
    "progress_count should be incremented once",
  );
  assertEqual(
    summary.sourceEventCount,
    1,
    "source_events should contain one event",
  );
  assertEqual(
    summary.idempotencyCount,
    CONCURRENT_ATTEMPTS,
    "each concurrent request should complete its own API idempotency record",
  );
}

function runPsqlSync(db: DbClient, sql: string): string {
  const result = spawnSync("docker", psqlArgs(db), {
    input: sql,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  assertSuccessfulProcess("docker exec psql", result);

  return result.stdout;
}

function runPsqlAsync(
  db: DbClient,
  sql: string,
  attempt: number,
): Promise<WorkerResult> {
  const child = spawn("docker", psqlArgs(db), {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const result = new Promise<WorkerResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        attempt,
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });

  child.stdin.end(sql);

  return result;
}

function psqlArgs(db: DbClient): string[] {
  return [
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
  ];
}

function resolveLocalSupabaseDbContainerName(): string {
  const configured = process.env.SIGNIN_CONCURRENCY_DB_CONTAINER?.trim();
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
        `Configured SIGNIN_CONCURRENCY_DB_CONTAINER was not found: ${configured}`,
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
    `Unable to choose a local Supabase DB container. Set SIGNIN_CONCURRENCY_DB_CONTAINER. Candidates: ${candidates.join(", ") || "(none)"}`,
  );
}

function parseLastJsonLine(
  stdout: string,
  label: string,
): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);

  if (!line) {
    throw new Error(`No JSON output returned from ${label}.`);
  }

  const parsed: unknown = JSON.parse(line);

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${label} to return a JSON object.`);
  }

  return parsed;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];

  if (!Array.isArray(field)) {
    throw new Error(`Expected ${key} to be an array.`);
  }

  return field;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];

  if (typeof field !== "boolean") {
    throw new Error(`Expected ${key} to be a boolean.`);
  }

  return field;
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];

  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Expected ${key} to be a finite number.`);
  }

  return field;
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];

  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }

  return field;
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, got ${String(actual)}.`,
    );
  }
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

function createRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function createTelegramUserId(): number {
  return 8_300_000_000 + Math.floor(Math.random() * 100_000_000);
}

function createShanghaiDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to create Asia/Shanghai sign-in date.");
  }

  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeContainerNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlString(value)}::uuid`;
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
