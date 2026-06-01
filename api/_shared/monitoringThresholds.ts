import { ApiError } from "./handler.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../packages/server/src/db/transactions.js";

export type MonitoringThresholds = {
  version: 1;
  paymentFailureRate: {
    warning: number;
    critical: number;
  };
  paidNotFulfilledMinutes: {
    critical: number;
  };
  webhookStuckMinutes: {
    warning: number;
    critical: number;
  };
  mintStuckMinutes: {
    warning: number;
    critical: number;
  };
  ledgerMismatchCount: {
    critical: number;
  };
  negativeInventoryCount: {
    critical: number;
  };
  kcoinNetIssuance: {
    warningAmount: number;
    windowHours: number;
  };
};

export type MonitoringThresholdConfig = {
  thresholds: MonitoringThresholds;
  updatedAt: string | null;
  source: "system_settings" | "defaults";
};

export const MONITORING_THRESHOLDS_SETTING_KEY = "monitoring.thresholds";
export const DEFAULT_MONITORING_WINDOW_HOURS = 24;
export const MAX_MONITORING_WINDOW_HOURS = 168;

export const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholds = {
  version: 1,
  paymentFailureRate: {
    warning: 0.05,
    critical: 0.1,
  },
  paidNotFulfilledMinutes: {
    critical: 10,
  },
  webhookStuckMinutes: {
    warning: 5,
    critical: 10,
  },
  mintStuckMinutes: {
    warning: 30,
    critical: 60,
  },
  ledgerMismatchCount: {
    critical: 0,
  },
  negativeInventoryCount: {
    critical: 0,
  },
  kcoinNetIssuance: {
    warningAmount: 1_000_000,
    windowHours: 24,
  },
};

export async function loadMonitoringThresholds(input: {
  adminUserId: string;
  requestContext?: JsonObject;
  requestId?: string;
}): Promise<MonitoringThresholdConfig> {
  let data: JsonObject;

  try {
    data = await runReadRpc<JsonObject>({
      schema: "api",
      functionName: "admin_get_monitoring_thresholds",
      args: {
        p_admin_user_id: input.adminUserId,
        p_request_context: input.requestContext ?? {},
      },
      traceId: input.requestId,
      label: "admin_get_monitoring_thresholds",
    });
  } catch (error) {
    throw new ApiError(
      500,
      "MONITORING_THRESHOLDS_LOOKUP_FAILED",
      "监控阈值配置查询失败。",
      { expose: false, cause: error },
    );
  }

  return {
    thresholds: normalizeMonitoringThresholds(data.thresholds),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    source: data.source === "system_settings" ? "system_settings" : "defaults",
  };
}

export function normalizeMonitoringThresholds(
  value: unknown,
  base: MonitoringThresholds = DEFAULT_MONITORING_THRESHOLDS,
): MonitoringThresholds {
  const record = isRecord(value) ? value : {};
  const paymentFailureRate = readRecord(record.paymentFailureRate);
  const paidNotFulfilledMinutes = readRecord(record.paidNotFulfilledMinutes);
  const webhookStuckMinutes = readRecord(record.webhookStuckMinutes);
  const mintStuckMinutes = readRecord(record.mintStuckMinutes);
  const ledgerMismatchCount = readRecord(record.ledgerMismatchCount);
  const negativeInventoryCount = readRecord(record.negativeInventoryCount);
  const kcoinNetIssuance = readRecord(record.kcoinNetIssuance);

  const paymentWarning = readBoundedNumber(
    paymentFailureRate.warning,
    base.paymentFailureRate.warning,
    0,
    1,
    "paymentFailureRate.warning",
  );
  const paymentCritical = readBoundedNumber(
    paymentFailureRate.critical,
    base.paymentFailureRate.critical,
    0,
    1,
    "paymentFailureRate.critical",
  );
  const webhookWarning = readBoundedNumber(
    webhookStuckMinutes.warning,
    base.webhookStuckMinutes.warning,
    1,
    24 * 60,
    "webhookStuckMinutes.warning",
  );
  const webhookCritical = readBoundedNumber(
    webhookStuckMinutes.critical,
    base.webhookStuckMinutes.critical,
    1,
    24 * 60,
    "webhookStuckMinutes.critical",
  );
  const mintWarning = readBoundedNumber(
    mintStuckMinutes.warning,
    base.mintStuckMinutes.warning,
    1,
    24 * 60,
    "mintStuckMinutes.warning",
  );
  const mintCritical = readBoundedNumber(
    mintStuckMinutes.critical,
    base.mintStuckMinutes.critical,
    1,
    24 * 60,
    "mintStuckMinutes.critical",
  );

  if (paymentCritical < paymentWarning) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "paymentFailureRate.critical must be greater than or equal to warning",
    );
  }

  if (webhookCritical < webhookWarning) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "webhookStuckMinutes.critical must be greater than or equal to warning",
    );
  }

  if (mintCritical < mintWarning) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "mintStuckMinutes.critical must be greater than or equal to warning",
    );
  }

  return {
    version: 1,
    paymentFailureRate: {
      warning: paymentWarning,
      critical: paymentCritical,
    },
    paidNotFulfilledMinutes: {
      critical: readBoundedNumber(
        paidNotFulfilledMinutes.critical,
        base.paidNotFulfilledMinutes.critical,
        1,
        24 * 60,
        "paidNotFulfilledMinutes.critical",
      ),
    },
    webhookStuckMinutes: {
      warning: webhookWarning,
      critical: webhookCritical,
    },
    mintStuckMinutes: {
      warning: mintWarning,
      critical: mintCritical,
    },
    ledgerMismatchCount: {
      critical: readBoundedInteger(
        ledgerMismatchCount.critical,
        base.ledgerMismatchCount.critical,
        0,
        1_000_000,
        "ledgerMismatchCount.critical",
      ),
    },
    negativeInventoryCount: {
      critical: readBoundedInteger(
        negativeInventoryCount.critical,
        base.negativeInventoryCount.critical,
        0,
        1_000_000,
        "negativeInventoryCount.critical",
      ),
    },
    kcoinNetIssuance: {
      warningAmount: readBoundedNumber(
        kcoinNetIssuance.warningAmount,
        base.kcoinNetIssuance.warningAmount,
        0,
        1_000_000_000_000,
        "kcoinNetIssuance.warningAmount",
      ),
      windowHours: readBoundedInteger(
        kcoinNetIssuance.windowHours,
        base.kcoinNetIssuance.windowHours,
        1,
        MAX_MONITORING_WINDOW_HOURS,
        "kcoinNetIssuance.windowHours",
      ),
    },
  };
}

export function parseMonitoringWindowHours(value: unknown): number {
  const parsed =
    typeof value === "string"
      ? Number.parseInt(value, 10)
      : Array.isArray(value) && typeof value[0] === "string"
        ? Number.parseInt(value[0], 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONITORING_WINDOW_HOURS;
  }

  return Math.min(parsed, MAX_MONITORING_WINDOW_HOURS);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a number between ${min} and ${max}`,
    );
  }

  return parsed;
}

function readBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  const parsed = readBoundedNumber(value, fallback, min, max, field);

  if (!Number.isInteger(parsed)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an integer`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
