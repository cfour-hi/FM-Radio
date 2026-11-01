import assert from "node:assert/strict";
import test from "node:test";
import { createSleepTimer } from "../src/lib/sleepTimer.ts";
function setup() {
  let now = 1000, expired = 0, id = 0;
  const jobs = new Map();
  const timer = createSleepTimer(() => expired++, () => now,
    (callback, delay) => { jobs.set(++id, {callback, delay}); return id; }, (id) => jobs.delete(id));
  return { timer, jobs, jump: (value) => { now = value; }, expired: () => expired };
}
test("绝对截止时间到期只执行一次，恢复前台立即检查", () => {
  const env = setup();
  env.timer.arm(61000);
  env.jump(60999); env.timer.check();
  assert.equal(env.expired(), 0);
  env.jump(90000); env.timer.check(); env.timer.check();
  assert.equal(env.expired(), 1);
  assert.equal(env.jobs.size, 0);
});
test("重新设置和取消清理旧任务，不受暂停或换台影响", () => {
  const env = setup();
  env.timer.arm(61000); env.timer.arm(121000);
  assert.equal(env.jobs.size, 1);
  env.jump(61000); env.timer.check();
  assert.equal(env.expired(), 0);
  env.timer.cancel(); env.jump(200000); env.timer.check();
  assert.equal(env.expired(), 0);
  assert.equal(env.jobs.size, 0);
});
test("过期截止时间立即停止，非法和空截止时间不启动", () => {
  const env = setup();
  env.timer.arm(null); env.timer.arm(NaN);
  assert.equal(env.jobs.size, 0);
  env.timer.arm(1000);
  assert.equal(env.expired(), 1);
});
