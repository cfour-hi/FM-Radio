import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

/*
 * 收藏的回归测试。
 *
 * 曾经的 bug：toggleFavorite 先把新列表写进 store，再用 getFavoriteIds()
 * 回读 localStorage 算 favoriteIds——而 localStorage 要到下一条语句才写。
 * 于是点一次图标不亮，用户以为没收藏上，再点一次就插出重复项。
 * 这里把「点一次就生效」「反复点不重复」两条钉住。
 */

const KEY = "fm-radio.favorites";
const store = new Map();

// store 模块在顶层读 localStorage，必须先装好桩再 import
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { useLibrary } = await importTs("../src/store/library.ts");
const { hasLegacyMigrationRun, mergeLegacyFavorites, readFavorites } =
  await importTs("../src/lib/favorites.ts");

const station = {
  id: "test-station",
  name: "测试电台",
  url: "https://example.com/stream.mp3",
};

const reset = () => {
  store.clear();
  useLibrary.setState({ favorites: [], favoriteIds: new Set() });
};

test("点一次收藏立即生效，不用点第二次", () => {
  reset();
  useLibrary.getState().toggleFavorite(station);

  assert.equal(useLibrary.getState().favorites.length, 1);
  assert.ok(useLibrary.getState().favoriteIds.has(station.id), "favoriteIds 必须同步更新，否则图标不亮");
  assert.equal(readFavorites().length, 1, "localStorage 同步落库");
});

test("反复点不会插出重复项", () => {
  reset();

  // 一次收藏 + 一次取消 + 一次再收藏，最终仍是 1 条
  useLibrary.getState().toggleFavorite(station);
  useLibrary.getState().toggleFavorite(station);
  useLibrary.getState().toggleFavorite(station);

  assert.equal(useLibrary.getState().favorites.length, 1);
  assert.ok(useLibrary.getState().favoriteIds.has(station.id));
  assert.equal(readFavorites().length, 1);
});

test("列表与 id 集合不同步时也不会插出重复项", () => {
  reset();
  // 模拟脏状态：列表里已经有这个台，但 favoriteIds 没跟上
  useLibrary.setState({ favorites: [station], favoriteIds: new Set() });

  useLibrary.getState().toggleFavorite(station);

  assert.equal(useLibrary.getState().favorites.length, 1, "添加分支也要按 id 去重");
  assert.ok(useLibrary.getState().favoriteIds.has(station.id));
});

test("解析收藏时按 id 收敛旧数据", () => {
  reset();
  store.set(KEY, JSON.stringify([station, { ...station }, { ...station, id: "other" }]));

  assert.equal(readFavorites().length, 2, "重复的 id 只保留一条");
});

test("hydrate 之后 favorites 与 favoriteIds 保持一致", async () => {
  reset();
  store.set(KEY, JSON.stringify([station, { ...station, id: "other" }]));

  await useLibrary.getState().hydrate();

  const state = useLibrary.getState();
  assert.equal(state.favorites.length, 2);
  assert.equal(state.favoriteIds.size, 2);
  assert.ok(state.favoriteIds.has(station.id));
  assert.equal(hasLegacyMigrationRun(), true, "迁移跑过一次后要留下标记");
});

test("迁移旧收藏：现有列表优先，旧数据去重后追加", () => {
  const current = [{ ...station, id: "current" }];
  const legacy = [
    { ...station, id: "old-1", savedAt: 3 },
    { ...station, id: "current", savedAt: 2 },
    { id: 5, url: "https://example.com/broken.mp3" }, // 坏行：没有合法 id
  ];

  const merged = mergeLegacyFavorites(current, legacy);

  assert.deepEqual(merged.map((s) => s.id), ["current", "old-1"]);
  assert.equal("savedAt" in merged[1], false, "Dexie 的时间戳不写进 localStorage");
});
