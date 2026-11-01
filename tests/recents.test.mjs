import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

/*
 * 最近收听从 IndexedDB 迁到 localStorage 后，行为要和原来一致：
 * 最新的在前、同一个台不重复、最多 30 条；旧库的数据合并一次就够。
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const {
  readRecents,
  writeRecents,
  touchRecent,
  clearRecents,
  mergeLegacyRecents,
  hasRecentsMigrationRun,
  markRecentsMigrationDone,
  RECENTS_LIMIT,
} = await importTs("../src/lib/recents.ts");

const station = (id) => ({ id, name: `台 ${id}`, url: `https://example.com/${id}.mp3` });
const reset = () => store.clear();

test("最新的排在最前，同一个台只留一条", () => {
  reset();
  touchRecent(station("a"));
  touchRecent(station("b"));
  touchRecent(station("a"));

  assert.deepEqual(readRecents().map((s) => s.id), ["a", "b"]);
});

test("最多保留 30 条，淘汰最旧的", () => {
  reset();
  for (let i = 0; i < 35; i++) touchRecent(station(`s${i}`));

  const ids = readRecents().map((s) => s.id);
  assert.equal(ids.length, RECENTS_LIMIT);
  assert.equal(ids[0], "s34");
  assert.equal(ids.at(-1), "s5");
});

test("读取时过滤坏行并按 id 去重", () => {
  reset();
  store.set("fm-radio.recents", JSON.stringify([station("a"), station("a"), { id: 5 }, null]));

  assert.deepEqual(readRecents().map((s) => s.id), ["a"]);
});

test("写入时也截断到上限", () => {
  reset();
  const many = Array.from({ length: 40 }, (_, i) => station(`w${i}`));

  assert.equal(writeRecents(many), true);
  assert.equal(readRecents().length, RECENTS_LIMIT);
});

test("迁移旧数据：现有优先、去重、剥离 playedAt", () => {
  const current = [{ ...station("current") }];
  const legacy = [
    { ...station("old-1"), playedAt: 3 },
    { ...station("current"), playedAt: 2 },
    { id: 5, url: "https://example.com/broken.mp3" },
  ];

  const merged = mergeLegacyRecents(current, legacy);

  assert.deepEqual(merged.map((s) => s.id), ["current", "old-1"]);
  assert.equal("playedAt" in merged[1], false);
});

test("清空与迁移标记", () => {
  reset();
  touchRecent(station("a"));
  clearRecents();
  assert.deepEqual(readRecents(), []);
  assert.equal(hasRecentsMigrationRun(), false);

  markRecentsMigrationDone();
  assert.equal(hasRecentsMigrationRun(), true);
});

test("hydrate 读取 localStorage 里的最近收听", async () => {
  reset();
  store.set("fm-radio.recents", JSON.stringify([station("r1"), station("r2")]));

  const { useLibrary } = await importTs("../src/store/library.ts");
  await useLibrary.getState().hydrate();

  assert.deepEqual(useLibrary.getState().recents.map((s) => s.id), ["r1", "r2"]);
});
