import assert from "node:assert/strict";
import test from "node:test";

import {
  hasConsumedSeededEntitlement,
  resolveTutorialStatus,
} from "../../apps/web/src/workflows/entry-experience/new-user-gacha-tutorial-state.ts";

test("only a server-confirmed welcome reward seeds the tutorial", () => {
  assert.equal(resolveTutorialStatus(null, true), "pending");
  assert.equal(resolveTutorialStatus(null, false), "inactive");
});

test("stored terminal choices are not overwritten by an idempotent login replay", () => {
  assert.equal(resolveTutorialStatus("completed", true), "completed");
  assert.equal(resolveTutorialStatus("dismissed", true), "dismissed");
  assert.equal(resolveTutorialStatus("pending", false), "pending");
});

test("authoritative success or a lower entitlement count completes the tutorial", () => {
  assert.equal(hasConsumedSeededEntitlement(true, 1, 1), true);
  assert.equal(hasConsumedSeededEntitlement(false, 1, 0), true);
  assert.equal(hasConsumedSeededEntitlement(false, 2, 1), true);
  assert.equal(hasConsumedSeededEntitlement(false, 1, 1), false);
});
