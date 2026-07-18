import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_BASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_MINI_APP_SHORT_NAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  REFERRAL_CODE_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  PAYMENT_SUPPORT_URL: z.string().url(),
  TON_NETWORK: z.enum(["mainnet", "testnet"]),
  TON_API_BASE_URL: z.string().url(),
  TON_API_KEY: z.string().min(1),
  TON_COLLECTION_ADDRESS: z.string().min(1),
  TON_MINT_VALUE_NANO: z.string().regex(/^[1-9][0-9]*$/),
  TON_MINT_AUTH_PRIVATE_KEY: z.string().min(64),
  NFT_METADATA_BASE_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof schema>;
let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}
