import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  type BuildSessionCookieOptions,
} from "../../packages/server/src/auth/issueSession.js";

export function buildAuthSessionCookie(
  token: string,
  maxAgeSeconds: number,
): string {
  return buildSessionCookie(token, {
    ...getAuthSessionCookieOptions(),
    maxAgeSeconds,
  });
}

export function buildExpiredAuthSessionCookie(): string {
  return buildExpiredSessionCookie(getAuthSessionCookieOptions());
}

function getAuthSessionCookieOptions(): Omit<
  BuildSessionCookieOptions,
  "maxAgeSeconds"
> {
  const options: Omit<BuildSessionCookieOptions, "maxAgeSeconds"> = {
    cookieName: getSessionCookieName(),
    sameSite: getSessionCookieSameSite(),
    secure: getSessionCookieSecure(),
  };
  const domain = getSessionCookieDomain();

  if (domain !== undefined) {
    options.domain = domain;
  }

  return options;
}

function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || SESSION_COOKIE_NAME;
}

function getSessionCookieDomain(): string | undefined {
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  return domain || undefined;
}

function getSessionCookieSameSite(): "Lax" | "Strict" | "None" {
  const raw = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();

  if (raw === "strict") {
    return "Strict";
  }

  if (raw === "none") {
    return "None";
  }

  return "Lax";
}

function getSessionCookieSecure(): boolean {
  if (isProductionLikeRuntime()) {
    return true;
  }

  const raw = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (raw === "true" || raw === "1" || raw === "yes") {
    return true;
  }

  if (raw === "false" || raw === "0" || raw === "no") {
    return false;
  }

  return isProductionLikeRuntime();
}

function isProductionLikeRuntime(): boolean {
  return (
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}
