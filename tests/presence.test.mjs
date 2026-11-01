import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { nextPhase, isPresent } = await importTs("../src/lib/presence.ts");

test("从关闭打开：先进入 enter，等一帧再进 open", () => {
  assert.equal(nextPhase("closed", true), "enter");
  // enter 期间 open 仍为真，不能提前跳到 open——那要等浏览器画完一帧
  assert.equal(nextPhase("enter", true), "enter");
  assert.equal(nextPhase("open", true), "open", "已经是 open 时保持不动");
});

test("从打开关闭：先进入 closing，不是直接 closed", () => {
  assert.equal(nextPhase("open", false), "closing");
  assert.equal(nextPhase("closing", false), "closing", "退场中再关一次幂等");
  assert.equal(nextPhase("closed", false), "closed");
});

test("入场途中就关掉也要能收", () => {
  assert.equal(nextPhase("enter", false), "closing");
});

test("关闭途中重新打开：回到 open，不重走入场", () => {
  // 关键用例：重走 enter 会让面板先跳回屏外再滑进来，看起来像闪了一下
  assert.equal(nextPhase("closing", true), "open");
});

test("只有 closed 不占 DOM", () => {
  assert.equal(isPresent("closed"), false);
  assert.equal(isPresent("enter"), true);
  assert.equal(isPresent("open"), true);
  assert.equal(isPresent("closing"), true, "退场这 180ms 元素还看得见");
});
