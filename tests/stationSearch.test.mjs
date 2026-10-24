import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchByName } from "../src/lib/stationSearch.ts";

function reference(stations, query, limit = 50) {
  const needle = query.trim().toLowerCase();
  if (!needle || limit <= 0) return [];
  return stations.filter((s) => s.name.toLowerCase().includes(needle))
    .sort((a, b) => b.clicks - a.clicks).slice(0, limit);
}

const datasets = ["core", "rest", "catalog"].map((part) => {
  const snapshot = JSON.parse(readFileSync(new URL(`../src/data/stations-${part}.json`, import.meta.url)));
  return snapshot.stations.map((row) => ({ id: row[0], name: row[1], clicks: Number(row[part === "catalog" ? 3 : 9]) || 0 }));
});

test("全部分片：搜索结果、排序和截断与原实现一致", () => {
  for (const stations of datasets) {
    const before = stations.slice();
    for (const query of ["radio", " RADIO ", "中国", "音乐", "FM", "a", "不存在的电台xyz", "", "  "]) {
      for (const limit of [0, 1, 50, 500]) {
        assert.deepEqual(searchByName(stations, query, limit), reference(stations, query, limit));
      }
    }
    assert.deepEqual(stations, before, "不改变原始队列顺序");
  }
});

test("同热度保持原顺序；新快照不会复用旧索引", () => {
  const stations = [{ id: "a", name: "FM A", clicks: 4 }, { id: "b", name: "fm B", clicks: 4 }];
  assert.deepEqual(searchByName(stations, "fm", 1), [stations[0]]);
  const next = [{ id: "c", name: "FM C", clicks: 10 }, ...stations];
  assert.deepEqual(searchByName(next, "fm"), next);
  assert.deepEqual(searchByName(stations, "fm"), stations);
});
