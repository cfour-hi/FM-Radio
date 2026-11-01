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

/** 将收藏列表写入 localStorage */
export function writeFavorites(stations: Station[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(stations));
  } catch {
    // 隐私模式或容量已满，静默失败
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

/** 检查是否已收藏 */
export function isFavorite(id: string): boolean {
  const favorites = readFavorites();
  return favorites.some((s) => s.id === id);
}

/** 清空所有收藏 */
export function clearFavorites(): void {
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch {
    // 忽略
  }
}
