import type { Station } from "./types";

/**
 * 最近收听。
 *
 * 和收藏一样存 localStorage：只有 30 条快照，同步读写足够；旧版 IndexedDB
 * 里的数据在启动时合并一次（见 legacyDb.ts），之后不再碰 IndexedDB。
 */

const RECENTS_KEY = "fm-radio.recents";
const MIGRATION_KEY = "fm-radio.recentsMigrated";

export const RECENTS_LIMIT = 30;

export function readRecents(): Station[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as Station[];
    if (!Array.isArray(rows)) return [];
    // 旧数据可能带重复项或坏行，读取时收敛一次
    return [...new Map(
      rows
        .filter((s) => s && typeof s.id === "string" && typeof s.url === "string")
        .map((s) => [s.id, s]),
    ).values()].slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/** 写入并截断到上限；返回是否真的写进去了（迁移靠它决定要不要标记完成）。 */
export function writeRecents(stations: Station[]): boolean {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(stations.slice(0, RECENTS_LIMIT)));
    return true;
  } catch {
    // 隐私模式或容量已满，静默失败
    return false;
  }
}

/** 把一台放到最前；已有的先删掉再插，保证不重复且顺序最新。 */
export function touchRecent(station: Station): void {
  const next = [station, ...readRecents().filter((s) => s.id !== station.id)];
  writeRecents(next);
}

export function clearRecents(): void {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    // 忽略
  }
}

export function hasRecentsMigrationRun(): boolean {
  try {
    return localStorage.getItem(MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRecentsMigrationDone(): void {
  try {
    localStorage.setItem(MIGRATION_KEY, "1");
  } catch {
    // 存储不可用时不标记，下次启动还会再试一次
  }
}

/**
 * 把 IndexedDB 时代的最近收听合并进当前列表。
 *
 * 当前已有顺序优先，旧数据按播放时间倒序接在后面；Dexie 行上的 playedAt
 * 不写进新存储。
 */
export function mergeLegacyRecents(
  current: Station[],
  legacy: (Station & { playedAt?: number })[],
): Station[] {
  const merged = [...current];
  const seen = new Set(current.map((s) => s.id));
  for (const row of legacy) {
    if (!row || typeof row.id !== "string" || typeof row.url !== "string") continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const station = { ...row };
    delete station.playedAt;
    merged.push(station);
  }
  return merged.slice(0, RECENTS_LIMIT);
}
