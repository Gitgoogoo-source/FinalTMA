import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "./env/index.ts";
import { ApiError } from "../http/errors.ts";

export type SessionCredential = {
  session_id: string;
};

const SESSION_TOKEN_VERSION = 1;
const SESSION_ID_BYTES = 16;
const SESSION_MAC_BYTES = 32;
const SESSION_PAYLOAD_BYTES = 1 + SESSION_ID_BYTES;
const SESSION_TOKEN_BYTES = SESSION_PAYLOAD_BYTES + SESSION_MAC_BYTES;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{66}$/;

export function issueToken(operationId: string): {
  token: string;
  hash: string;
  sessionId: string;
} {
  const sessionBytes = createHmac("sha256", getEnv().IDENTITY_SECURITY_SECRET)
    .update(`evomypet-session-id-v1:${operationId}`)
    .digest()
    .subarray(0, SESSION_ID_BYTES);
  sessionBytes[6] = (sessionBytes[6]! & 0x0f) | 0x80;
  sessionBytes[8] = (sessionBytes[8]! & 0x3f) | 0x80;
  const payload = Buffer.alloc(SESSION_PAYLOAD_BYTES);
  payload[0] = SESSION_TOKEN_VERSION;
  sessionBytes.copy(payload, 1);
  const token = Buffer.concat([payload, signSessionPayload(payload)]).toString(
    "base64url",
  );
  return {
    token,
    hash: hashToken(token),
    sessionId: uuidFromBytes(sessionBytes),
  };
}

export function identityFingerprint(domain: string, value: string): string {
  return createHmac("sha256", getEnv().IDENTITY_SECURITY_SECRET)
    .update(`evomypet-identity-v1:${domain}:${value}`)
    .digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function referralCode(telegramId: number): string {
  const signature = createHmac("sha256", getEnv().REFERRAL_CODE_SECRET)
    .update(`evomypet-referral-v1:${telegramId}`)
    .digest("hex")
    .slice(0, 20);
  return `TMA${signature.toUpperCase()}`;
}

export function authenticateSessionCredential(
  request: Request,
): SessionCredential {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) throw sessionRequired();

  const decoded = Buffer.from(token, "base64url");
  if (
    decoded.length !== SESSION_TOKEN_BYTES ||
    decoded.toString("base64url") !== token ||
    decoded[0] !== SESSION_TOKEN_VERSION
  )
    throw sessionRequired();

  const payload = decoded.subarray(0, SESSION_PAYLOAD_BYTES);
  const suppliedMac = decoded.subarray(SESSION_PAYLOAD_BYTES);
  const expectedMac = signSessionPayload(payload);
  if (!timingSafeEqual(suppliedMac, expectedMac)) throw sessionRequired();

  return {
    session_id: uuidFromBytes(payload.subarray(1)),
  };
}

function signSessionPayload(payload: Uint8Array): Buffer {
  return createHmac("sha256", getEnv().IDENTITY_SECURITY_SECRET)
    .update("evomypet-session-proof-v1:")
    .update(payload)
    .digest();
}

function uuidFromBytes(value: Uint8Array): string {
  const hex = Buffer.from(value).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sessionRequired(): ApiError {
  return new ApiError(
    401,
    "SESSION_REQUIRED",
    "请从 Telegram 重新打开 Mini App",
  );
}
