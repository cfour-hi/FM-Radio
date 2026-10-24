import { create } from "zustand";
import {
  clearRecents,
  dropFavorite,
  listFavorites,
  listRecents,
  saveFavorite,
  touchRecent,
} from "../lib/db";
import type { Station } from "../lib/types";

type LibraryState = {
  favorites: Station[];
  favoriteIds: Set<string>;
  recents: Station[];
  ready: boolean;
  hydrate: () => Promise<void>;
  toggleFavorite: (station: Station) => Promise<void>;
  isFavorite: (id: string) => boolean;
  remember: (station: Station) => Promise<void>;
  forgetRecents: () => Promise<void>;
};

export const useLibrary = create<LibraryState>((set, get) => ({
  favorites: [],
  favoriteIds: new Set(),
  recents: [],
  ready: false,

  hydrate: async () => {
    const [favorites, recents] = await Promise.all([listFavorites(), listRecents()]);
    set({ favorites, favoriteIds: new Set(favorites.map((s) => s.id)), recents, ready: true });
  },

  toggleFavorite: async (station) => {
    const current = get();
    const exists = current.favoriteIds.has(station.id);

    // 先改界面再落库：点收藏必须是瞬时的
    const favorites = exists
      ? current.favorites.filter((s) => s.id !== station.id)
      : [station, ...current.favorites];

    set({ favorites, favoriteIds: new Set(favorites.map((s) => s.id)) });

    if (exists) await dropFavorite(station.id);
    else await saveFavorite(station);
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
