export type AuthSessionConfig = Readonly<{
  ttlSeconds: number;
  refreshThresholdSeconds: number;
  maxLifetimeSeconds: number;
  telegramInitDataMaxAgeSeconds: number;
  telegramInitDataClockToleranceSeconds: number;
}>;

export const AUTH_SESSION_DEFAULTS = Object.freeze({
  ttlSeconds: 7 * 24 * 60 * 60,
  refreshThresholdSeconds: 24 * 60 * 60,
  maxLifetimeSeconds: 30 * 24 * 60 * 60,
  telegramInitDataMaxAgeSeconds: 24 * 60 * 60,
  telegramInitDataClockToleranceSeconds: 5 * 60,
});

export const AUTH_SESSION_LIMITS = Object.freeze({
  minTtlSeconds: 60,
  maxTtlSeconds: 30 * 24 * 60 * 60,
  maxLifetimeSeconds: 90 * 24 * 60 * 60,
  maxTelegramInitDataAgeSeconds: 7 * 24 * 60 * 60,
  maxTelegramInitDataClockToleranceSeconds: 10 * 60,
});

type EnvSource = Record<string, string | undefined>;

export function getAuthSessionConfig(
  source: EnvSource = process.env,
): AuthSessionConfig {
  const ttlSeconds = readDurationSeconds(source, "SESSION_TTL_SECONDS", {
    defaultValue: AUTH_SESSION_DEFAULTS.ttlSeconds,
    min: AUTH_SESSION_LIMITS.minTtlSeconds,
    max: AUTH_SESSION_LIMITS.maxTtlSeconds,
  });

  const maxLifetimeSeconds = Math.max(
    ttlSeconds,
    readDurationSeconds(source, "SESSION_MAX_LIFETIME_SECONDS", {
      defaultValue: AUTH_SESSION_DEFAULTS.maxLifetimeSeconds,
      min: AUTH_SESSION_LIMITS.minTtlSeconds,
      max: AUTH_SESSION_LIMITS.maxLifetimeSeconds,
    }),
  );

  const refreshThresholdSeconds = Math.min(
    ttlSeconds,
    readDurationSeconds(source, "SESSION_REFRESH_THRESHOLD_SECONDS", {
      defaultValue: AUTH_SESSION_DEFAULTS.refreshThresholdSeconds,
      min: AUTH_SESSION_LIMITS.minTtlSeconds,
      max: maxLifetimeSeconds,
    }),
  );

  return {
    ttlSeconds,
    maxLifetimeSeconds,
    refreshThresholdSeconds,
    telegramInitDataMaxAgeSeconds: readDurationSeconds(
      source,
      "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS",
      {
        defaultValue: AUTH_SESSION_DEFAULTS.telegramInitDataMaxAgeSeconds,
        min: AUTH_SESSION_LIMITS.minTtlSeconds,
        max: AUTH_SESSION_LIMITS.maxTelegramInitDataAgeSeconds,
      },
    ),
    telegramInitDataClockToleranceSeconds: readDurationSeconds(
      source,
      "TELEGRAM_INIT_DATA_CLOCK_TOLERANCE_SECONDS",
      {
        defaultValue:
          AUTH_SESSION_DEFAULTS.telegramInitDataClockToleranceSeconds,
        min: 0,
        max: AUTH_SESSION_LIMITS.maxTelegramInitDataClockToleranceSeconds,
      },
    ),
  };
}

export function secondsUntil(target: Date | string, now = new Date()): number {
  const targetMs =
    target instanceof Date ? target.getTime() : Date.parse(target);
  const nowMs = now.getTime();

  if (!Number.isFinite(targetMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((targetMs - nowMs) / 1000));
}

function readDurationSeconds(
  source: EnvSource,
  key: string,
  options: {
    defaultValue: number;
    min: number;
    max: number;
  },
): number {
  const raw = source[key];

  if (typeof raw !== "string" || raw.trim() === "") {
    return options.defaultValue;
  }

  const value = Number(raw.trim());

  if (!Number.isFinite(value)) {
    return options.defaultValue;
  }

  const integer = Math.floor(value);

  if (integer < options.min) {
    return options.min;
  }

  if (integer > options.max) {
    return options.max;
  }

  return integer;
}
