import { describe, expect, it } from "vitest";

import {
  normalizeTelegramUserIds,
  parseCliOptions,
} from "../../scripts/create-admin";

describe("scripts/create-admin", () => {
  it("reads comma-separated bootstrap ids from env and de-duplicates them", () => {
    const options = parseCliOptions(["--dry-run"], {
      ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS: " 123456 , , 789012,123456 ",
    });

    expect(options).toEqual({
      dryRun: true,
      roleCode: "SUPER_ADMIN",
      telegramUserIds: ["123456", "789012"],
      telegramUserIdSource: "env",
    });
  });

  it("lets --telegram-user-id override env ids for one-person bootstrap", () => {
    const options = parseCliOptions(
      ["--telegram-user-id", "345678", "--role-code=ops"],
      {
        ADMIN_BOOTSTRAP_TELEGRAM_USER_IDS: "123456,789012",
      },
    );

    expect(options).toEqual({
      dryRun: false,
      roleCode: "OPS",
      telegramUserIds: ["345678"],
      telegramUserIdSource: "cli",
    });
  });

  it("rejects non-positive and unsafe Telegram ids before any database work", () => {
    expect(() =>
      normalizeTelegramUserIds(["123456", "0", "not-a-number"]),
    ).toThrow("Invalid Telegram user id values");

    expect(() => normalizeTelegramUserIds(["9007199254740993"])).toThrow(
      "Invalid Telegram user id values",
    );
  });
});
