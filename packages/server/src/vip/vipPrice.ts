export const VIP_MONTHLY_PRICE_XTR_ENV = "VIP_MONTHLY_PRICE_XTR";
export const VIP_MONTHLY_PRICE_KCOIN_ENV = "VIP_MONTHLY_PRICE_KCOIN";

export class VipPriceConfigError extends Error {
  readonly code = "VIP_PRICE_CONFIG_INVALID";
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message: string) {
    super(message);
    this.name = "VipPriceConfigError";
  }
}

export function readVipMonthlyPriceXtr(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveSafeIntEnv(env, VIP_MONTHLY_PRICE_XTR_ENV);
}

export function readVipMonthlyPriceKcoin(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveSafeIntEnv(env, VIP_MONTHLY_PRICE_KCOIN_ENV);
}

function readPositiveSafeIntEnv(
  env: NodeJS.ProcessEnv,
  envName: string,
): number {
  const rawValue = env[envName];
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    throw new VipPriceConfigError(`${envName} is required on the server.`);
  }

  if (!/^\d+$/.test(value)) {
    throw new VipPriceConfigError(`${envName} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new VipPriceConfigError(`${envName} must be a positive safe integer.`);
  }

  return parsed;
}
