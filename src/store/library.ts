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
  hasRecentsMigrationRun,
  markRecentsMigrationDone,
  mergeLegacyRecents,
  readRecents,
  RECENTS_LIMIT,
  writeRecents,
} from "../lib/recents";
import { readLegacyFavorites, readLegacyRecents } from "../lib/legacyDb";
import {
  hide,
  readHidden,
  unhide,
  unhideAll,
  type HiddenEntry,
  type HiddenReason,
} from "../lib/hiddenStations";
import type { Station } from "../lib/types";

type LibraryState = {
  favorites: Station[];
  favoriteIds: Set<string>;
  recents: Station[];
  hidden: HiddenEntry[];
  hiddenIds: Set<string>;
  hydrate: () => Promise<void>;
  toggleFavorite: (station: Station) => void;
  isFavorite: (id: string) => boolean;
  remember: (station: Station) => void;
  forgetRecents: () => void;
  refreshHidden: () => void;
  hideStation: (station: Station, reason?: HiddenReason) => void;
  unhideStation: (id: string) => void;
  unhideAllStations: () => void;
};

export const useLibrary = create<LibraryState>((set, get) => ({
  favorites: [],
  favoriteIds: new Set(),
  recents: [],
  hidden: [],
  hiddenIds: new Set(),

  hydrate: async () => {
    // 收藏从 localStorage 同步读取；首次启动还要把 IndexedDB 里的旧收藏并进来
    let favorites = readFavorites();
    if (!hasLegacyMigrationRun()) {
      const merged = mergeLegacyFavorites(favorites, await readLegacyFavorites());
      /*
       * 写不进去（隐私模式、配额满）就不标记完成，下次启动再试一次。
       * 合并按 id 去重，重复执行没有副作用。
       */
      if (writeFavorites(merged)) markLegacyMigrationDone();
      favorites = merged;
    }

    // 最近收听同样迁到 localStorage；旧库只在第一次启动时读一次
    let recents = readRecents();
    if (!hasRecentsMigrationRun()) {
      const merged = mergeLegacyRecents(recents, await readLegacyRecents());
      if (writeRecents(merged)) markRecentsMigrationDone();
      recents = merged;
    }

    const hidden = readHidden();
    set({
      favorites,
      favoriteIds: new Set(favorites.map((s) => s.id)),
      recents,
      hidden,
      hiddenIds: new Set(hidden.map((entry) => entry.id)),
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

  remember: (station) => {
    const next = [station, ...get().recents.filter((s) => s.id !== station.id)]
      .slice(0, RECENTS_LIMIT);
    set({ recents: next });
    writeRecents(next);
  },

  forgetRecents: () => {
    set({ recents: [] });
    clearRecents();
  },

  refreshHidden: () => {
    const hidden = readHidden();
    set({ hidden, hiddenIds: new Set(hidden.map((entry) => entry.id)) });
  },

  hideStation: (station, reason = "manual") => {
    const hidden = hide(station, reason);
    set({ hidden, hiddenIds: new Set(hidden.map((entry) => entry.id)) });
  },

  unhideStation: (id) => {
    const hidden = unhide(id);
    set({ hidden, hiddenIds: new Set(hidden.map((entry) => entry.id)) });
  },

  unhideAllStations: () => {
    const hidden = unhideAll();
    set({ hidden, hiddenIds: new Set(hidden.map((entry) => entry.id)) });
  },
}));
