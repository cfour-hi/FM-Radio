import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { describeMediaError } = await importTs("../src/player/errors.ts");

test("MediaError.code 一对一映射到分类与文案", () => {
  const r1 = describeMediaError(1);
  assert.equal(r1.message, "加载被中断了");
  assert.equal(r1.kind, "aborted");
  assert.ok(r1.hint?.includes("重试"));
  
  const r2 = describeMediaError(2);
  assert.equal(r2.message, "网络中断，这个台此刻可能不可达");
  assert.equal(r2.kind, "network");
  assert.ok(r2.hint?.includes("网络"));
  
  const r3 = describeMediaError(3);
  assert.equal(r3.message, "音频解码失败，可能是编码不受支持");
  assert.equal(r3.kind, "decode");
  assert.ok(r3.hint?.includes("格式"));
  
  const r4 = describeMediaError(4);
  assert.equal(r4.message, "地址不可用或格式不受支持");
  assert.equal(r4.kind, "src-not-supported");
  assert.ok(r4.hint?.includes("同城"));
});

test("没有 code 或 code 不认识时兜底为 unknown", () => {
  assert.equal(describeMediaError(undefined).kind, "unknown");
  assert.equal(describeMediaError(0).kind, "unknown");
  assert.equal(describeMediaError(99).kind, "unknown");
});

test("每种分类都有可读文案，不会漏出空串", () => {
  for (const code of [1, 2, 3, 4, undefined]) {
    const { message } = describeMediaError(code);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0);
  }
});
