import type { Station } from "./types";

// 分片是不可变快照。每份数组只排序、规范化一次，旧快照释放后索引也可回收。
const indexes = new WeakMap<Station[], { station: Station; name: string }[]>();

export function searchByName(stations: Station[], q: string, limit = 50): Station[] {
  const needle = q.trim().toLowerCase();
  if (!needle || limit <= 0) return [];
  let index = indexes.get(stations);
  if (!index) {
    index = stations
      .map((station) => ({ station, name: station.name.toLowerCase() }))
      .sort((a, b) => b.station.clicks - a.station.clicks);
    indexes.set(stations, index);
  }
  const hits: Station[] = [];
  for (const entry of index) {
    if (!entry.name.includes(needle)) continue;
    hits.push(entry.station);
    if (hits.length >= limit) break;
  }
  return hits;
}
