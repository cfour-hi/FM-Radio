import type { Station } from "./types";

/**
 * 使用 localStorage 持久化收藏。
 * 
 * 相比 IndexedDB 的优势：
 * - 更简单，无需异步操作
 * - 同步读写，UI 响应更快
 * - 容量足够（500 个收藏约 10KB）
 */

const FAVORITES_KEY = "fm-radio.favorites";
/** 旧 IndexedDB 收藏是否已经并进来；清掉 localStorage 后会重新迁移。 */
const MIGRATION_KEY = "fm-radio.favoritesMigrated";

/** 从 localStorage 读取收藏列表 */
export function readFavorites(): Station[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const stations = JSON.parse(raw) as Station[];
    // 验证数据结构
    if (!Array.isArray(stations)) return [];
    // 按 id 去重：旧版本 toggleFavorite 曾在内存里插出重复项，
    // 读取时收敛一次，避免脏数据一直显示两条。
    return [...new Map(
      stations
        .filter((s) => s && typeof s.id === "string" && typeof s.url === "string")
        .map((s) => [s.id, s]),
    ).values()];
  } catch {
    return [];
  }
}

/** 将收藏列表写入 localStorage。返回是否真的写进去了，迁移靠它决定要不要标记完成。 */
export function writeFavorites(stations: Station[]): boolean {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(stations));
    return true;
  } catch {
    // 隐私模式或容量已满，静默失败
    return false;
  }
}

/** 添加收藏 */
export function addFavorite(station: Station): void {
  const favorites = readFavorites();
  // 避免重复
  if (!favorites.some((s) => s.id === station.id)) {
    favorites.unshift(station);
    writeFavorites(favorites);
  }
}

/** 取消收藏 */
export function removeFavorite(id: string): void {
  const favorites = readFavorites();
  const filtered = favorites.filter((s) => s.id !== id);
  writeFavorites(filtered);
}

/* ---------------- 从 IndexedDB 迁移 ---------------- */

export function hasLegacyMigrationRun(): boolean {
  try {
    return localStorage.getItem(MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLegacyMigrationDone(): void {
  try {
    localStorage.setItem(MIGRATION_KEY, "1");
  } catch {
    // 存储不可用时不标记，下次启动还会再试一次
  }
}

/**
 * 把 IndexedDB 时代的收藏合并进当前列表。
 *
 * localStorage 里已有的 id 优先——用户可能在新存储里改过收藏；旧数据按
 * 保存时间倒序接在后面。Dexie 行上的 savedAt 不写进新存储。
 */
export function mergeLegacyFavorites(
  current: Station[],
  legacy: (Station & { savedAt?: number })[],
): Station[] {
  const merged = [...current];
  const seen = new Set(current.map((s) => s.id));
  for (const row of legacy) {
    if (!row || typeof row.id !== "string" || typeof row.url !== "string") continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const station = { ...row };
    delete station.savedAt;
    merged.push(station);
  }
  return merged;
}
