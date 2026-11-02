import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { hide, isHidden, readHidden, recordFailure, unhide, unhideAll } =
  await importTs("../src/lib/hiddenStations.ts");

const station = (id) => ({
  id,
  name: `台 ${id}`,
  url: `https://example.com/${id}.mp3`,
  codec: "MP3",
  sslError: false,
});

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const reset = () => store.clear();

test("软失败只记录在本次播放，不写入隐藏列表", () => {
  reset();
  assert.equal(recordFailure(station("a"), "network", NOW), false);
  assert.equal(recordFailure(station("a"), "buffer-timeout", NOW), false);
  assert.deepEqual(readHidden(), []);
});

test("硬失败 7 天内累计两次自动隐藏", () => {
  reset();
  assert.equal(recordFailure(station("a"), "connect-timeout", NOW), false);
  assert.equal(recordFailure(station("a"), "decode", NOW + 1000), true);
  assert.equal(isHidden("a"), true);
  const [entry] = readHidden();
  assert.equal(entry.count, 2);
});

test("超过 7 天窗口重新计数", () => {
  reset();
  recordFailure(station("a"), "connect-timeout", NOW);
  assert.equal(recordFailure(station("a"), "connect-timeout", NOW + 8 * DAY), false);
  assert.equal(recordFailure(station("a"), "connect-timeout", NOW + 8 * DAY + 1000), true);
});

test("手动隐藏与恢复", () => {
  reset();
  hide(station("a"), "manual", NOW);
  assert.equal(isHidden("a"), true);
  assert.equal(readHidden()[0].reason, "manual");
  unhide("a");
  assert.equal(isHidden("a"), false);
});

test("全部恢复清空列表", () => {
  reset();
  hide(station("a"), "manual", NOW);
  hide(station("b"), "manual", NOW);
  unhideAll();
  assert.deepEqual(readHidden(), []);
});

test("隐藏列表上限 200，保留最近的记录", () => {
  reset();
  for (let i = 0; i < 210; i++) hide(station(`s${i}`), "manual", NOW + i);
  const entries = readHidden();
  assert.equal(entries.length, 200);
  assert.equal(entries[0].id, "s209");
});

test("重复隐藏同一个台不会产生重复记录", () => {
  reset();
  hide(station("a"), "manual", NOW);
  hide(station("a"), "manual", NOW + 1);
  assert.equal(readHidden().length, 1);
});
