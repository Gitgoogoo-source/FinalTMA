export const VIP_MONTHLY_PRICE_XTR_ENV = "VIP_MONTHLY_PRICE_XTR";

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
  const rawValue = env[VIP_MONTHLY_PRICE_XTR_ENV];
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    throw new VipPriceConfigError(
      `${VIP_MONTHLY_PRICE_XTR_ENV} is required on the server.`,
    );
  }

  if (!/^\d+$/.test(value)) {
    throw new VipPriceConfigError(
      `${VIP_MONTHLY_PRICE_XTR_ENV} must be a positive integer.`,
    );
  }

  const priceXtr = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(priceXtr) || priceXtr <= 0) {
    throw new VipPriceConfigError(
      `${VIP_MONTHLY_PRICE_XTR_ENV} must be a positive safe integer.`,
    );
  }

  return priceXtr;
}
