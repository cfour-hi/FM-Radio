import Dexie, { type Table } from "dexie";
import type { Station } from "./types";

/** IndexedDB 时代的收藏行，只读；新收藏已经改走 localStorage。 */
export type LegacyFavoriteRow = Station & { savedAt: number };
export type RecentRow = Station & { playedAt: number };

/** 本地收藏 / 最近收听。全部在本地，不登录、不上传。 */
class RadioDatabase extends Dexie {
  favorites!: Table<LegacyFavoriteRow, string>;
  recents!: Table<RecentRow, string>;

  constructor() {
    super("fm-radio");
    /*
     * v1 曾建过 cache 表（API 响应缓存），后来电台目录改走构建期分片 +
     * HTTP 缓存，那份 IndexedDB 缓存就废弃了。版本号保留递增，v2 不再
     * 声明 cache——老用户升级后旧表仍留在库里，只是没有任何代码再读写。
     */
    this.version(1).stores({ cache: "key, fetchedAt" });
    /*
     * favorites 表保留不动：收藏已经改存 localStorage，但这张表里还有老
     * 用户的数据，启动时会被读出来合并一次（见 listLegacyFavorites）。
     * 删表就等于删数据，迁移稳定之前不要动它。
     */
    this.version(2).stores({
      favorites: "id, savedAt",
      recents: "id, playedAt",
    });
  }
}

const available = typeof indexedDB !== "undefined";

export const db = available ? new RadioDatabase() : null;

/* ---------------- 收藏（旧数据，只读） ---------------- */

/** 读出 IndexedDB 时代的收藏，供启动时一次性迁到 localStorage。 */
export async function listLegacyFavorites(): Promise<LegacyFavoriteRow[]> {
  if (!db) return [];
  try {
    return await db.favorites.orderBy("savedAt").reverse().toArray();
  } catch {
    return [];
  }
}

/* ---------------- 最近收听 ---------------- */

const RECENTS_LIMIT = 30;

export async function listRecents(): Promise<Station[]> {
  if (!db) return [];
  try {
    const rows = await db.recents.orderBy("playedAt").reverse().limit(RECENTS_LIMIT).toArray();
    return rows;
  } catch {
    return [];
  }
}

export async function touchRecent(station: Station): Promise<void> {
  if (!db) return;
  try {
    await db.recents.put({ ...station, playedAt: Date.now() });
    // 只留最近的若干条，别让它无限长
    const count = await db.recents.count();
    if (count > RECENTS_LIMIT) {
      const stale = await db.recents
        .orderBy("playedAt")
        .reverse()
        .offset(RECENTS_LIMIT)
        .primaryKeys();
      await db.recents.bulkDelete(stale);
    }
  } catch {
    /* 忽略 */
  }
}

export async function clearRecents(): Promise<void> {
  if (!db) return;
  try {
    await db.recents.clear();
  } catch {
    /* 忽略 */
  }
}
