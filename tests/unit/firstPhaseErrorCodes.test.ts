import { describe, expect, it } from "vitest";

import {
  ERROR_CODE,
  FIRST_PHASE_ERROR_CODES,
  getErrorMeta,
  toPublicError,
  type ErrorCode,
} from "../../packages/domain/src/errors";
import {
  statusCodeFromErrorCode,
  type ApiErrorCode,
} from "../../api/_shared/errors";

const GUIDE_ERROR_CODES = [
  ERROR_CODE.AUTH_INIT_DATA_INVALID,
  ERROR_CODE.AUTH_SESSION_EXPIRED,
  ERROR_CODE.USER_BLOCKED,
  ERROR_CODE.BOX_NOT_FOUND,
  ERROR_CODE.BOX_NOT_ACTIVE,
  ERROR_CODE.BOX_STOCK_NOT_ENOUGH,
  ERROR_CODE.DRAW_COUNT_INVALID,
  ERROR_CODE.ORDER_ALREADY_PROCESSED,
  ERROR_CODE.ORDER_NOT_FOUND,
  ERROR_CODE.DROP_POOL_EMPTY,
  ERROR_CODE.BALANCE_LEDGER_FAILED,
  ERROR_CODE.INVENTORY_CREATE_FAILED,
  ERROR_CODE.IDEMPOTENCY_CONFLICT,
] as const;

const EXPECTED_HTTP_STATUS = {
  AUTH_INIT_DATA_INVALID: 401,
  AUTH_SESSION_EXPIRED: 401,
  USER_BLOCKED: 403,
  BOX_NOT_FOUND: 404,
  BOX_NOT_ACTIVE: 400,
  BOX_STOCK_NOT_ENOUGH: 409,
  DRAW_COUNT_INVALID: 400,
  ORDER_ALREADY_PROCESSED: 409,
  ORDER_NOT_FOUND: 404,
  DROP_POOL_EMPTY: 409,
  BALANCE_LEDGER_FAILED: 500,
  INVENTORY_CREATE_FAILED: 500,
  IDEMPOTENCY_CONFLICT: 409,
} satisfies Record<(typeof GUIDE_ERROR_CODES)[number], number>;

describe("first-phase error codes", () => {
  it("keeps the guide section 7 error codes as the public first-phase set", () => {
    expect(FIRST_PHASE_ERROR_CODES).toEqual(GUIDE_ERROR_CODES);
  });

  it("has public messages and API status mappings for every first-phase code", () => {
    for (const code of GUIDE_ERROR_CODES) {
      const publicError = toPublicError(code as ErrorCode);

      expect(publicError).toMatchObject({
        code,
        message: expect.any(String),
      });
      expect(publicError.message.length).toBeGreaterThan(0);
      expect(getErrorMeta(code as ErrorCode).httpStatus).toBe(
        EXPECTED_HTTP_STATUS[code],
      );
      expect(statusCodeFromErrorCode(code as ApiErrorCode)).toBe(
        EXPECTED_HTTP_STATUS[code],
      );
    }
  });
});
