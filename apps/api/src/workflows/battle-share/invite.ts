import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "../../platform/env/index.ts";

export function battleInviteToken(operationId: string): string {
  const token = createHmac("sha256", getEnv().BATTLE_INVITE_SECRET)
    .update(`battle-invite-v1|${operationId}`)
    .digest()
    .subarray(0, 24)
    .toString("base64url");
  return `BTL_${token}`;
}

export function battleInviteTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteHashMatches(
  token: string,
  expectedHash: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(battleInviteTokenHash(token), "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}
