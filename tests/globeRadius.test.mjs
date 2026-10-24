import assert from "node:assert/strict";
import test from "node:test";
import { createGlobeRadiusSync } from "../src/map/globeRadius.ts";

test("隐藏期间零测量，恢复可见与窗口变化后重新校准", () => {
  let calls = 0;
  let radius = 300;
  const applied = [];
  const sync = createGlobeRadiusSync(() => { calls++; return radius; }, (r) => applied.push(r));
  sync.sync(2, true);
  sync.sync(2.001, true);
  assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) sync.sync(4.6 + i / 100, false);
  assert.equal(calls, 1);
  radius = 400;
  sync.sync(2, true);
  assert.deepEqual(applied, [300, 400]);
  radius = 450;
  sync.invalidate();
  sync.sync(2, true);
  assert.deepEqual(applied, [300, 400, 450]);
  sync.sync(2.01, true);
  assert.equal(calls, 4);
});

test("尺寸失效期间不计算，异常投影结果不会阻止下一次重试", () => {
  let radius = Number.NaN;
  let calls = 0;
  const applied = [];
  const sync = createGlobeRadiusSync(() => { calls++; return radius; }, (r) => applied.push(r));
  sync.invalidate();
  sync.sync(5, false);
  assert.equal(calls, 0);
  sync.sync(2, true);
  radius = 10;
  sync.sync(2, true);
  radius = 300;
  sync.sync(2, true);
  assert.equal(calls, 3);
  assert.deepEqual(applied, [300]);
});
