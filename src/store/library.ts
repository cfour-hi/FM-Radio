import { create } from "zustand";
import {
  addFavorite,
  hasLegacyMigrationRun,
  markLegacyMigrationDone,
  mergeLegacyFavorites,
  readFavorites,
  removeFavorite,
  writeFavorites,
} from "../lib/favorites";
import {
  clearRecents,
  listLegacyFavorites,
  listRecents,
  touchRecent,
} from "../lib/db";
import type { Station } from "../lib/types";

type LibraryState = {
  favorites: Station[];
  favoriteIds: Set<string>;
  recents: Station[];
  hydrate: () => Promise<void>;
  toggleFavorite: (station: Station) => void;
  isFavorite: (id: string) => boolean;
  remember: (station: Station) => Promise<void>;
  forgetRecents: () => Promise<void>;
};

export const useLibrary = create<LibraryState>((set, get) => ({
  favorites: [],
  favoriteIds: new Set(),
  recents: [],

  hydrate: async () => {
    // 收藏从 localStorage 同步读取；首次启动还要把 IndexedDB 里的旧收藏并进来
    let favorites = readFavorites();
    if (!hasLegacyMigrationRun()) {
      const legacy = await listLegacyFavorites();
      const merged = mergeLegacyFavorites(favorites, legacy);
      /*
       * 写不进去（隐私模式、配额满）就不标记完成，下次启动再试一次。
       * 合并按 id 去重，重复执行没有副作用。
       */
      if (writeFavorites(merged)) markLegacyMigrationDone();
      favorites = merged;
    }
    // 最近收听从 IndexedDB 异步读取
    const recents = await listRecents();
    set({
      favorites,
      favoriteIds: new Set(favorites.map((s) => s.id)),
      recents,
    });
  },

  toggleFavorite: (station) => {
    const current = get();
    const exists = current.favoriteIds.has(station.id);

    // 先改界面再落库：点收藏必须是瞬时的
    const favorites = exists
      ? current.favorites.filter((s) => s.id !== station.id)
      : [station, ...current.favorites.filter((s) => s.id !== station.id)];

    // 内存状态自己推导，不要回读 localStorage——落库在下一行才发生，
    // 回读拿到的是旧集合，会导致图标不亮、再点一次插出重复项。
    set({ favorites, favoriteIds: new Set(favorites.map((s) => s.id)) });

    // localStorage 同步写入
    if (exists) removeFavorite(station.id);
    else addFavorite(station);
  },

  isFavorite: (id) => get().favoriteIds.has(id),

  remember: async (station) => {
    const rest = get().recents.filter((s) => s.id !== station.id);
    set({ recents: [station, ...rest].slice(0, 30) });
    await touchRecent(station);
  },

  forgetRecents: async () => {
    set({ recents: [] });
    await clearRecents();
  },
}));
