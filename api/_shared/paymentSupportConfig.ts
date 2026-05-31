import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError } from "./handler.js";

export type PaymentSupportConfig = {
  configured: boolean;
  supportUrl: string | null;
  supportEmail: string | null;
  updatedAt: string | null;
  source: "system_settings" | "server_env" | "none";
};

type SystemSettingRow = {
  key: string;
  value: unknown;
  updated_at: string | null;
};

const PAYMENT_SUPPORT_SETTING_KEY = "PAYMENT_SUPPORT_CONFIG";

export async function loadPaymentSupportConfig(
  db: SupabaseAdminClient = getSupabaseAdminClient(),
): Promise<PaymentSupportConfig> {
  const { data, error } = await db
    .schema("ops")
    .from("system_settings")
    .select("key,value,updated_at")
    .eq("key", PAYMENT_SUPPORT_SETTING_KEY);

  if (error) {
    throw new ApiError(
      500,
      "PAYMENT_SUPPORT_CONFIG_LOOKUP_FAILED",
      "支付客服配置查询失败。",
      { expose: false, cause: error },
    );
  }

  const row = Array.isArray(data)
    ? ((data[0] ?? null) as unknown as SystemSettingRow | null)
    : null;
  const settingConfig = row ? normalizeSystemSettingConfig(row) : null;

  if (settingConfig?.configured) {
    return settingConfig;
  }

  const envConfig = normalizeEnvPaymentSupportConfig();

  if (envConfig.configured) {
    return envConfig;
  }

  return (
    settingConfig ?? {
      configured: false,
      supportEmail: null,
      supportUrl: null,
      updatedAt: null,
      source: "none",
    }
  );
}

function normalizeSystemSettingConfig(
  row: SystemSettingRow,
): PaymentSupportConfig {
  const value = isRecord(row.value) ? row.value : {};
  const supportUrl = normalizeSupportUrl(
    readString(value.support_url) ?? readString(value.supportUrl),
  );
  const supportEmail = normalizeSupportEmail(
    readString(value.support_email) ?? readString(value.supportEmail),
  );
  const configuredFlag = readBoolean(value.configured);
  const configured =
    configuredFlag === true && (supportUrl !== null || supportEmail !== null);

  return {
    configured,
    supportEmail: configured ? supportEmail : null,
    supportUrl: configured ? supportUrl : null,
    updatedAt: row.updated_at ?? null,
    source: "system_settings",
  };
}

function normalizeEnvPaymentSupportConfig(): PaymentSupportConfig {
  const supportUrl = normalizeSupportUrl(process.env.PAYMENT_SUPPORT_URL);
  const supportEmail = normalizeSupportEmail(process.env.PAYMENT_SUPPORT_EMAIL);
  const configured = supportUrl !== null || supportEmail !== null;

  return {
    configured,
    supportEmail,
    supportUrl,
    updatedAt: null,
    source: configured ? "server_env" : "none",
  };
}

function normalizeSupportUrl(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);

  if (!normalized || isPlaceholderValue(normalized)) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeSupportEmail(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeText(value)?.toLowerCase() ?? null;

  if (!normalized || isPlaceholderValue(normalized)) {
    return null;
  }

  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)
    ? normalized
    : null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("replace_with") ||
    normalized === "support@example.com" ||
    normalized.endsWith(".example.com")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
