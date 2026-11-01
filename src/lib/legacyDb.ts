import type { Station } from "./types";

/*
 * IndexedDB 时代的本地数据，只在启动时读一次做迁移。
 *
 * 应用已经不再往这个库写入；这里用原生 API 读取，避免为了迁移继续带着
 * Dexie 依赖。浏览器不支持 indexedDB.databases() 时直接跳过——与其冒险
 * 打开一个可能不存在的库（会顺手建出一个空库），不如放弃这一次迁移。
 */

const DB_NAME = "fm-radio";

export type LegacyFavoriteRow = Station & { savedAt?: number };
export type LegacyRecentRow = Station & { playedAt?: number };

type LegacyRow = LegacyFavoriteRow & LegacyRecentRow;

function timestamp(row: LegacyRow): number {
  return row.savedAt ?? row.playedAt ?? 0;
}

async function openLegacyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;

  try {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === DB_NAME)) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

/** 按时间倒序读出某个 store 的前 limit 条；任何异常都当作没有旧数据。 */
async function readStore(storeName: string, indexName: string, limit: number): Promise<LegacyRow[]> {
  const db = await openLegacyDb();
  if (!db) return [];

  try {
    if (!db.objectStoreNames.contains(storeName)) return [];
    return await new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      // Dexie 建过的时间索引；万一没有，退回全表再排序
      const source = store.indexNames.contains(indexName) ? store.index(indexName) : store;
      const request = source.getAll();
      request.onsuccess = () => {
        const rows = ((request.result ?? []) as LegacyRow[])
          .slice()
          .sort((a, b) => timestamp(b) - timestamp(a));
        resolve(rows.slice(0, limit));
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function readLegacyFavorites(): Promise<LegacyFavoriteRow[]> {
  return readStore("favorites", "savedAt", Number.POSITIVE_INFINITY);
}

export async function readLegacyRecents(): Promise<LegacyRecentRow[]> {
  return readStore("recents", "playedAt", 30);
}
