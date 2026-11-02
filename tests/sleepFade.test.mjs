import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { fadePlan, SLEEP_FADE_MS } = await importTs("../src/lib/sleepTimer.ts");

const NOW = 1_700_000_000_000;

test("离截止还早：先等待，最后 30 秒再淡出", () => {
  assert.deepEqual(fadePlan(NOW + 120_000, NOW), {
    delay: 90_000,
    duration: SLEEP_FADE_MS,
  });
});

test("剩余不足 30 秒：立即开始，只淡剩余时长", () => {
  assert.deepEqual(fadePlan(NOW + 10_000, NOW), { delay: 0, duration: 10_000 });
});

test("没有定时或已经过期：不安排淡出", () => {
  assert.equal(fadePlan(null, NOW), null);
  assert.equal(fadePlan(NOW, NOW), null);
  assert.equal(fadePlan(NOW - 1, NOW), null);
  assert.equal(fadePlan(Number.NaN, NOW), null);
});
