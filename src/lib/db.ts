import Dexie, { type Table } from "dexie";
import type { Station } from "./types";

export type FavoriteRow = Station & { savedAt: number };
export type RecentRow = Station & { playedAt: number };

/** 本地收藏 / 最近收听。全部在本地，不登录、不上传。 */
class RadioDatabase extends Dexie {
  favorites!: Table<FavoriteRow, string>;
  recents!: Table<RecentRow, string>;

  constructor() {
    super("fm-radio");
    /*
     * v1 曾建过 cache 表（API 响应缓存），后来电台目录改走构建期分片 +
     * HTTP 缓存，那份 IndexedDB 缓存就废弃了。版本号保留递增，v2 不再
     * 声明 cache——老用户升级后旧表仍留在库里，只是没有任何代码再读写。
     */
    this.version(1).stores({ cache: "key, fetchedAt" });
    this.version(2).stores({
      favorites: "id, savedAt",
      recents: "id, playedAt",
    });
  }
}

const available = typeof indexedDB !== "undefined";

export const db = available ? new RadioDatabase() : null;

/* ---------------- 收藏 ---------------- */

export async function listFavorites(): Promise<Station[]> {
  if (!db) return [];
  try {
    const rows = await db.favorites.orderBy("savedAt").reverse().toArray();
    return rows;
  } catch {
    return [];
  }
}

export async function saveFavorite(station: Station): Promise<void> {
  if (!db) return;
  try {
    await db.favorites.put({ ...station, savedAt: Date.now() });
  } catch {
    /* 存不下就算了，界面仍会显示这一次的收藏态 */
  }
}

export async function dropFavorite(id: string): Promise<void> {
  if (!db) return;
  try {
    await db.favorites.delete(id);
  } catch {
    /* 忽略 */
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
