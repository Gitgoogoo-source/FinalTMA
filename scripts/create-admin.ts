import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../packages/server/src/db/supabaseAdmin.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = { [key: string]: JsonValue };

export type CliOptions = {
  dryRun: boolean;
  roleCode: string;
  telegramUserIds: string[];
  telegramUserIdSource: "env" | "cli";
};

type EnvLike = Record<string, string | undefined>;

type ScriptError = {
  code: string;
  message: string;
  values?: string[];
  context?: Record<string, JsonValue>;
};

type AdminRoleRow = {
  id: string;
  code: string;
  display_name: string | null;
  permissions: unknown;
};

type CoreUserRow = {
  id: string;
  telegram_user_id: string | number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

type AdminUserRow = {
  id: string;
  core_user_id: string | null;
  telegram_user_id: string | number | null;
  display_name: string | null;
  status: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type AdminUserRoleRow = {
  admin_user_id: string;
  role_id: string;
  granted_at: string | null;
};

type AdminBootstrapResult = {
  telegram_user_id: string;
  core_user_id: string | null;
  admin_user_id: string | null;
  admin_user_action: "created" | "updated" | "would_create" | "would_update";
  role_action: "granted" | "skipped" | "would_grant" | "would_skip";
  audit_action: "written" | "would_write";
};

class CreateAdminScriptError extends Error {
  public readonly errors: ScriptError[];

  constructor(message: string, errors: ScriptError[]) {
    super(message);
    this.name = "CreateAdminScriptError";
    this.errors = errors;
  }
}

const DEFAULT_ROLE_CODE = "SUPER_ADMIN";
const ADMIN_BOOTSTRAP_ENV = "ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS";
const BOOTSTRAP_SOURCE = "bootstrap_script";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(getHelpText());
    return;
  }

  loadLocalEnvFile();

  const options = parseCliOptions(args, process.env);
  const db = getSupabaseAdminClient();
  const bootstrappedAt = new Date().toISOString();
  const role = await loadAdminRole(db, options.roleCode);
  const results: AdminBootstrapResult[] = [];

  for (const telegramUserId of options.telegramUserIds) {
    results.push(
      await bootstrapTelegramAdmin(db, {
        telegramUserId,
        role,
        dryRun: options.dryRun,
        bootstrappedAt,
      }),
    );
  }

  console.log(
    JSON.stringify(
      buildSuccessOutput({
        options,
        role,
        results,
      }),
      null,
      2,
    ),
  );
}

export function parseCliOptions(
  args: string[],
  env: EnvLike = process.env,
): CliOptions {
  let dryRun = false;
  let cliTelegramUserId: string | null = null;
  let roleCode = DEFAULT_ROLE_CODE;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      continue;
    }

    if (arg === "--telegram-user-id") {
      cliTelegramUserId = parseSingleValueFlag(
        args,
        index,
        "--telegram-user-id",
        cliTelegramUserId,
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--telegram-user-id=")) {
      cliTelegramUserId = parseSingleInlineFlag(
        arg,
        "--telegram-user-id",
        cliTelegramUserId,
      );
      continue;
    }

    if (arg === "--role-code") {
      roleCode = normalizeRoleCode(
        parseRequiredNextValue(args, index, "--role-code"),
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--role-code=")) {
      roleCode = normalizeRoleCode(arg.slice("--role-code=".length));
      continue;
    }

    throw new CreateAdminScriptError(`Unknown argument: ${arg}`, [
      {
        code: "UNKNOWN_ARGUMENT",
        message: `Unknown argument: ${arg}`,
        values: [arg],
      },
    ]);
  }

  assertProductionBootstrapEnvConfigured(env);

  const telegramUserIdSource = cliTelegramUserId ? "cli" : "env";
  const telegramUserIds = cliTelegramUserId
    ? normalizeTelegramUserIds([cliTelegramUserId])
    : normalizeTelegramUserIds(readEnvTelegramUserIds(env));

  return {
    dryRun,
    roleCode,
    telegramUserIds,
    telegramUserIdSource,
  };
}

function assertProductionBootstrapEnvConfigured(env: EnvLike): void {
  if (!isProductionBootstrapRuntime(env)) {
    return;
  }

  const raw = env[ADMIN_BOOTSTRAP_ENV];

  if (raw?.trim()) {
    return;
  }

  throw new CreateAdminScriptError(
    `${ADMIN_BOOTSTRAP_ENV} is required before running admin bootstrap in production.`,
    [
      {
        code: "ADMIN_BOOTSTRAP_IDS_REQUIRED_IN_PRODUCTION",
        message: `${ADMIN_BOOTSTRAP_ENV} is required before running admin bootstrap in production.`,
        values: [ADMIN_BOOTSTRAP_ENV],
        context: {
          vercel_env: env.VERCEL_ENV ?? null,
          app_env: env.APP_ENV ?? null,
        },
      },
    ],
  );
}

function isProductionBootstrapRuntime(env: EnvLike): boolean {
  return (
    normalizeEnvName(env.VERCEL_ENV) === "production" ||
    normalizeEnvName(env.APP_ENV) === "production"
  );
}

function normalizeEnvName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseSingleValueFlag(
  args: string[],
  index: number,
  flag: string,
  currentValue: string | null,
): string {
  if (currentValue !== null) {
    throw new CreateAdminScriptError(`${flag} can only be provided once`, [
      {
        code: "DUPLICATE_ARGUMENT",
        message: `${flag} can only be provided once`,
        values: [flag],
      },
    ]);
  }

  return parseRequiredNextValue(args, index, flag);
}

function parseSingleInlineFlag(
  arg: string,
  flag: string,
  currentValue: string | null,
): string {
  if (currentValue !== null) {
    throw new CreateAdminScriptError(`${flag} can only be provided once`, [
      {
        code: "DUPLICATE_ARGUMENT",
        message: `${flag} can only be provided once`,
        values: [flag],
      },
    ]);
  }

  return parseNonEmptyString(arg.slice(`${flag}=`.length), flag);
}

function parseRequiredNextValue(
  args: string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new CreateAdminScriptError(`${flag} requires a value`, [
      {
        code: "MISSING_ARGUMENT_VALUE",
        message: `${flag} requires a value`,
        values: [flag],
      },
    ]);
  }

  return parseNonEmptyString(value, flag);
}

function parseNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new CreateAdminScriptError(`${name} must not be empty`, [
      {
        code: "EMPTY_ARGUMENT_VALUE",
        message: `${name} must not be empty`,
        values: [name],
      },
    ]);
  }

  return trimmed;
}

function readEnvTelegramUserIds(env: EnvLike): string[] {
  const raw = env[ADMIN_BOOTSTRAP_ENV];

  if (!raw?.trim()) {
    throw new CreateAdminScriptError(
      `Missing ${ADMIN_BOOTSTRAP_ENV}. Set it or pass --telegram-user-id.`,
      [
        {
          code: "ADMIN_BOOTSTRAP_IDS_REQUIRED",
          message: `Missing ${ADMIN_BOOTSTRAP_ENV}. Set it or pass --telegram-user-id.`,
          values: [ADMIN_BOOTSTRAP_ENV],
        },
      ],
    );
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeTelegramUserIds(values: string[]): string[] {
  const invalidValues: string[] = [];
  const normalizedValues: string[] = [];
  const seenValues = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();

    if (!/^[1-9]\d*$/.test(trimmed)) {
      invalidValues.push(value);
      continue;
    }

    const numericValue = Number(trimmed);

    if (!Number.isSafeInteger(numericValue)) {
      invalidValues.push(value);
      continue;
    }

    if (!seenValues.has(trimmed)) {
      seenValues.add(trimmed);
      normalizedValues.push(trimmed);
    }
  }

  if (invalidValues.length > 0) {
    throw new CreateAdminScriptError("Invalid Telegram user id values", [
      {
        code: "INVALID_TELEGRAM_USER_ID",
        message: "Telegram user ids must be positive safe integers.",
        values: invalidValues,
      },
    ]);
  }

  if (normalizedValues.length === 0) {
    throw new CreateAdminScriptError(
      `No Telegram user ids found in ${ADMIN_BOOTSTRAP_ENV}`,
      [
        {
          code: "ADMIN_BOOTSTRAP_IDS_EMPTY",
          message: `No Telegram user ids found in ${ADMIN_BOOTSTRAP_ENV}`,
          values: [ADMIN_BOOTSTRAP_ENV],
        },
      ],
    );
  }

  return normalizedValues;
}

function normalizeRoleCode(value: string): string {
  const trimmed = parseNonEmptyString(value, "--role-code");
  return trimmed.toUpperCase();
}

function toTelegramUserIdNumber(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CreateAdminScriptError("Invalid Telegram user id values", [
      {
        code: "INVALID_TELEGRAM_USER_ID",
        message: "Telegram user ids must be positive safe integers.",
        values: [value],
      },
    ]);
  }

  return parsed;
}

async function bootstrapTelegramAdmin(
  db: SupabaseAdminClient,
  input: {
    telegramUserId: string;
    role: AdminRoleRow;
    dryRun: boolean;
    bootstrappedAt: string;
  },
): Promise<AdminBootstrapResult> {
  const coreUser = await loadCoreUser(db, input.telegramUserId);
  const existingAdminUser = await loadAdminUser(db, input.telegramUserId);
  const existingRoleLink = existingAdminUser
    ? await loadAdminUserRole(db, existingAdminUser.id, input.role.id)
    : null;

  const coreUserId = coreUser?.id ?? existingAdminUser?.core_user_id ?? null;
  const displayName = buildDisplayName(input.telegramUserId, coreUser);
  const adminUserAction = existingAdminUser ? "updated" : "created";
  const roleAction = existingRoleLink ? "skipped" : "granted";

  if (input.dryRun) {
    return {
      telegram_user_id: input.telegramUserId,
      core_user_id: coreUserId,
      admin_user_id: existingAdminUser?.id ?? null,
      admin_user_action: existingAdminUser ? "would_update" : "would_create",
      role_action: existingRoleLink ? "would_skip" : "would_grant",
      audit_action: "would_write",
    };
  }

  const metadata = buildBootstrapMetadata(
    existingAdminUser?.metadata,
    input.bootstrappedAt,
    input.role.code,
  );
  const adminUser = await upsertAdminUser(db, {
    telegramUserId: input.telegramUserId,
    coreUserId,
    displayName,
    metadata,
  });

  if (!existingRoleLink) {
    await grantAdminRole(db, adminUser.id, input.role.id);
  }

  await writeBootstrapAuditLog(db, {
    adminUserId: adminUser.id,
    roleCode: input.role.code,
    targetId: adminUser.id,
    beforeState: {
      admin_user: existingAdminUser
        ? serializeAdminUser(existingAdminUser)
        : null,
      role_link_exists: existingRoleLink !== null,
    },
    afterState: {
      telegram_user_id: input.telegramUserId,
      core_user_id: adminUser.core_user_id,
      role_code: input.role.code,
      admin_user_action: adminUserAction,
      role_action: roleAction,
      source: BOOTSTRAP_SOURCE,
      bootstrapped_at: input.bootstrappedAt,
    },
  });

  return {
    telegram_user_id: input.telegramUserId,
    core_user_id: adminUser.core_user_id,
    admin_user_id: adminUser.id,
    admin_user_action: adminUserAction,
    role_action: roleAction,
    audit_action: "written",
  };
}

async function loadAdminRole(
  db: SupabaseAdminClient,
  roleCode: string,
): Promise<AdminRoleRow> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_roles")
    .select("id,code,display_name,permissions")
    .eq("code", roleCode)
    .maybeSingle<AdminRoleRow>();

  assertNoDbError(error, "ADMIN_ROLE_LOOKUP_FAILED", {
    role_code: roleCode,
  });

  if (!data) {
    throw new CreateAdminScriptError(
      `Admin role ${roleCode} does not exist. Apply the seed/migration first.`,
      [
        {
          code: "ADMIN_ROLE_NOT_FOUND",
          message: `Admin role ${roleCode} does not exist. Apply the seed/migration first.`,
          values: [roleCode],
        },
      ],
    );
  }

  return data;
}

async function loadCoreUser(
  db: SupabaseAdminClient,
  telegramUserId: string,
): Promise<CoreUserRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("id,telegram_user_id,username,first_name,last_name")
    .eq("telegram_user_id", toTelegramUserIdNumber(telegramUserId))
    .maybeSingle<CoreUserRow>();

  assertNoDbError(error, "CORE_USER_LOOKUP_FAILED", {
    telegram_user_id: telegramUserId,
  });

  return data ?? null;
}

async function loadAdminUser(
  db: SupabaseAdminClient,
  telegramUserId: string,
): Promise<AdminUserRow | null> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_users")
    .select(
      "id,core_user_id,telegram_user_id,display_name,status,metadata,created_at,updated_at",
    )
    .eq("telegram_user_id", toTelegramUserIdNumber(telegramUserId))
    .maybeSingle<AdminUserRow>();

  assertNoDbError(error, "ADMIN_USER_LOOKUP_FAILED", {
    telegram_user_id: telegramUserId,
  });

  return data ?? null;
}

async function loadAdminUserRole(
  db: SupabaseAdminClient,
  adminUserId: string,
  roleId: string,
): Promise<AdminUserRoleRow | null> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_user_roles")
    .select("admin_user_id,role_id,granted_at")
    .eq("admin_user_id", adminUserId)
    .eq("role_id", roleId)
    .maybeSingle<AdminUserRoleRow>();

  assertNoDbError(error, "ADMIN_USER_ROLE_LOOKUP_FAILED", {
    admin_user_id: adminUserId,
    role_id: roleId,
  });

  return data ?? null;
}

async function upsertAdminUser(
  db: SupabaseAdminClient,
  input: {
    telegramUserId: string;
    coreUserId: string | null;
    displayName: string;
    metadata: JsonRecord;
  },
): Promise<AdminUserRow> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_users")
    .upsert(
      {
        telegram_user_id: toTelegramUserIdNumber(input.telegramUserId),
        core_user_id: input.coreUserId,
        display_name: input.displayName,
        status: "active",
        metadata: input.metadata,
      },
      {
        onConflict: "telegram_user_id",
      },
    )
    .select(
      "id,core_user_id,telegram_user_id,display_name,status,metadata,created_at,updated_at",
    )
    .single<AdminUserRow>();

  assertNoDbError(error, "ADMIN_USER_UPSERT_FAILED", {
    telegram_user_id: input.telegramUserId,
  });

  if (!data) {
    throw new CreateAdminScriptError("Admin user upsert returned no row", [
      {
        code: "ADMIN_USER_UPSERT_EMPTY",
        message: "Admin user upsert returned no row",
        context: {
          telegram_user_id: input.telegramUserId,
        },
      },
    ]);
  }

  return data;
}

async function grantAdminRole(
  db: SupabaseAdminClient,
  adminUserId: string,
  roleId: string,
): Promise<void> {
  const { error } = await db.schema("ops").from("admin_user_roles").insert({
    admin_user_id: adminUserId,
    role_id: roleId,
    granted_by_admin_id: null,
  });

  assertNoDbError(error, "ADMIN_ROLE_GRANT_FAILED", {
    admin_user_id: adminUserId,
    role_id: roleId,
  });
}

async function writeBootstrapAuditLog(
  db: SupabaseAdminClient,
  input: {
    adminUserId: string;
    roleCode: string;
    targetId: string;
    beforeState: JsonRecord;
    afterState: JsonRecord;
  },
): Promise<void> {
  const { error } = await db
    .schema("ops")
    .from("admin_audit_logs")
    .insert({
      admin_user_id: input.adminUserId,
      action:
        input.roleCode === DEFAULT_ROLE_CODE
          ? "admin.bootstrap_super_admin"
          : "admin.bootstrap_role",
      target_schema: "ops",
      target_table: "admin_users",
      target_id: input.targetId,
      before_state: input.beforeState,
      after_state: input.afterState,
      reason: "bootstrap admin via scripts/create-admin.ts",
    });

  assertNoDbError(error, "ADMIN_AUDIT_LOG_WRITE_FAILED", {
    admin_user_id: input.adminUserId,
    target_id: input.targetId,
  });
}

function buildBootstrapMetadata(
  existingMetadata: unknown,
  bootstrappedAt: string,
  roleCode: string,
): JsonRecord {
  const metadata = isJsonRecord(existingMetadata)
    ? { ...existingMetadata }
    : {};

  metadata.source = BOOTSTRAP_SOURCE;
  metadata.bootstrapped_at = bootstrappedAt;
  metadata.bootstrap_role_code = roleCode;

  return metadata;
}

function buildDisplayName(
  telegramUserId: string,
  coreUser: CoreUserRow | null,
): string {
  const username = coreUser?.username?.trim();

  if (username) {
    return `@${username.replace(/^@+/, "")}`;
  }

  const fullName = [coreUser?.first_name, coreUser?.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

  if (fullName) {
    return fullName;
  }

  return `Telegram ${telegramUserId}`;
}

function serializeAdminUser(adminUser: AdminUserRow): JsonRecord {
  return {
    id: adminUser.id,
    core_user_id: adminUser.core_user_id,
    telegram_user_id:
      adminUser.telegram_user_id === null
        ? null
        : String(adminUser.telegram_user_id),
    display_name: adminUser.display_name,
    status: adminUser.status,
    metadata: isJsonValue(adminUser.metadata) ? adminUser.metadata : null,
    created_at: adminUser.created_at,
    updated_at: adminUser.updated_at,
  };
}

function buildSuccessOutput(input: {
  options: CliOptions;
  role: AdminRoleRow;
  results: AdminBootstrapResult[];
}): JsonRecord {
  const createdCount = input.results.filter((result) =>
    ["created", "would_create"].includes(result.admin_user_action),
  ).length;
  const updatedCount = input.results.filter((result) =>
    ["updated", "would_update"].includes(result.admin_user_action),
  ).length;
  const roleGrantedCount = input.results.filter((result) =>
    ["granted", "would_grant"].includes(result.role_action),
  ).length;
  const skippedCount = input.results.filter((result) =>
    ["skipped", "would_skip"].includes(result.role_action),
  ).length;

  return {
    ok: true,
    dry_run: input.options.dryRun,
    role_code: input.role.code,
    role_id: input.role.id,
    telegram_user_id_source: input.options.telegramUserIdSource,
    created_count: createdCount,
    updated_count: updatedCount,
    role_granted_count: roleGrantedCount,
    skipped_count: skippedCount,
    errors: [],
    admins: input.results,
  };
}

function assertNoDbError(
  error: unknown,
  code: string,
  context: Record<string, JsonValue>,
): void {
  if (!error) {
    return;
  }

  const dbError = normalizeUnknownError(error);

  throw new CreateAdminScriptError(dbError.message, [
    {
      code,
      message: dbError.message,
      context: {
        ...context,
        details: dbError.details,
        hint: dbError.hint,
        db_code: dbError.code,
      },
    },
  ]);
}

function normalizeUnknownError(error: unknown): {
  message: string;
  details: string | null;
  hint: string | null;
  code: string | null;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: null,
      hint: null,
      code: null,
    };
  }

  if (isRecord(error)) {
    return {
      message:
        typeof error.message === "string" ? error.message : "Unknown error",
      details: typeof error.details === "string" ? error.details : null,
      hint: typeof error.hint === "string" ? error.hint : null,
      code: typeof error.code === "string" ? error.code : null,
    };
  }

  return {
    message: String(error),
    details: null,
    hint: null,
    code: null,
  };
}

function normalizeCaughtErrors(error: unknown): ScriptError[] {
  if (error instanceof CreateAdminScriptError) {
    return error.errors;
  }

  const normalized = normalizeUnknownError(error);

  return [
    {
      code: "CREATE_ADMIN_FAILED",
      message: normalized.message,
      context: {
        details: normalized.details,
        hint: normalized.hint,
        db_code: normalized.code,
      },
    },
  ];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadLocalEnvFile(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function getHelpText(): string {
  return [
    "Usage: pnpm ops:create-admin [--dry-run] [--telegram-user-id=123456789] [--role-code=SUPER_ADMIN]",
    "",
    `Without --telegram-user-id, reads ${ADMIN_BOOTSTRAP_ENV} as a comma-separated list.`,
    "Production bootstrap requires that env variable to be configured; CLI single-user mode is for staging/local checks.",
    "Creates or refreshes ops.admin_users and grants an existing ops.admin_roles code.",
    "Use --dry-run to preview changes without writing to Supabase.",
  ].join("\n");
}

function isMainModule(): boolean {
  const entry = process.argv[1];

  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const errors = normalizeCaughtErrors(error);

    console.error(
      JSON.stringify(
        {
          ok: false,
          dry_run: null,
          role_code: null,
          created_count: 0,
          updated_count: 0,
          role_granted_count: 0,
          skipped_count: 0,
          errors,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
