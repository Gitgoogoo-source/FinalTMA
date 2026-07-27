import { z } from "zod";

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_BASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(32),
  IDENTITY_SECURITY_SECRET: z
    .string()
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  REFERRAL_CODE_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  PAYMENT_SUPPORT_URL: z.string().url(),
});

const serverSchema = baseSchema.superRefine((value, context) => {
  if (value.IDENTITY_SECURITY_SECRET === value.REFERRAL_CODE_SECRET)
    context.addIssue({
      code: "custom",
      path: ["REFERRAL_CODE_SECRET"],
      message: "Identity and referral secrets must be distinct",
    });
});

const battleSchema = z
  .object({
    ABLY_API_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/),
    BATTLE_OUTBOX_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, "utf8") >= 32),
    BATTLE_INVITE_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, "utf8") >= 32),
  })
  .superRefine((value, context) => {
    const secrets = [
      process.env.IDENTITY_SECURITY_SECRET,
      process.env.REFERRAL_CODE_SECRET,
      value.BATTLE_OUTBOX_SECRET,
      value.BATTLE_INVITE_SECRET,
    ].filter((secret): secret is string => Boolean(secret));
    if (new Set(secrets).size !== secrets.length)
      context.addIssue({
        code: "custom",
        path: ["BATTLE_INVITE_SECRET"],
        message: "Identity, referral, and Battle secrets must be distinct",
      });
  });

const referralSchema = z.object({
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
  TELEGRAM_MINI_APP_SHORT_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

const tonSchema = z.object({
  APP_BASE_URL: z.string().url(),
  TON_NETWORK: z.enum(["mainnet", "testnet"]),
  TON_API_BASE_URL: z.string().url(),
  TON_API_KEY: z.string().min(1),
  TON_COLLECTION_ADDRESS: z.string().min(1),
  TON_MINT_VALUE_NANO: z.string().regex(/^[1-9][0-9]*$/),
  TON_MINT_AUTH_PRIVATE_KEY: z.string().min(64),
  NFT_METADATA_BASE_URL: z.string().url(),
});

const databaseSchema = baseSchema.pick({
  SUPABASE_URL: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type BattleEnv = z.infer<typeof battleSchema>;
export type DatabaseEnv = z.infer<typeof databaseSchema>;
export type ReferralEnv = z.infer<typeof referralSchema>;
export type TonEnv = z.infer<typeof tonSchema>;
let cached: ServerEnv | undefined;
let cachedBattle: BattleEnv | undefined;
let cachedDatabase: DatabaseEnv | undefined;
let cachedReferral: ReferralEnv | undefined;
let cachedTon: TonEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= serverSchema.parse(process.env);
  return cached;
}

export function getBattleEnv(): BattleEnv {
  cachedBattle ??= battleSchema.parse(process.env);
  return cachedBattle;
}

export function getDatabaseEnv(): DatabaseEnv {
  cachedDatabase ??= databaseSchema.parse(process.env);
  return cachedDatabase;
}

export function getReferralEnv(): ReferralEnv {
  cachedReferral ??= referralSchema.parse(process.env);
  return cachedReferral;
}

export function getTonEnv(): TonEnv {
  cachedTon ??= tonSchema.parse(process.env);
  return cachedTon;
}
