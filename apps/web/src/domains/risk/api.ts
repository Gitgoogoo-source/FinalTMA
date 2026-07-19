export const riskErrorCodes = ["ACCOUNT_RESTRICTED", "RATE_LIMITED"] as const;

export type RiskErrorCode = (typeof riskErrorCodes)[number];
