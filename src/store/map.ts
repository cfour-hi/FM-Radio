import { create } from "zustand";

/*
 * 地图的跨组件信号。
 *
 * 首页就是地图，顶栏的 logo 和地图右上角的「回到世界」按钮要做同一件事：
 * 把镜头飞回全球视角。Header 和 MapPage 是兄弟组件，没有直接的父子关系，
 * 靠 zustand 存一个递增的 token，谁点谁 +1，MapPage 读到变化就把视角复位。
 *
 * 定位到某一个台也走同一条路：播放条点标题、分享链接解析出目标，都是
 * 「外部要求地图飞到某处」，WorldMap 只认 focus 这一个 prop。
 */

export type Focus = { lon: number; lat: number; token: number };

type MapState = {
  /** 每次「回到世界」都 +1，MapPage 监听它的变化触发 fitWorld */
  flyHomeToken: number;
  flyHome: () => void;
  /** 单点定位请求；token 递增让「同一个坐标连点两次」也能再飞一次 */
  focus: Focus | null;
  focusStation: (geo: { lon: number; lat: number }) => void;
  /** 每次按「/」都 +1：抽屉没开时先把抽屉打开，再把焦点送进搜索框 */
  searchFocusToken: number;
  focusSearch: () => void;
};

export const useMapStore = create<MapState>((set) => ({
  flyHomeToken: 0,
  flyHome: () => set((s) => ({ flyHomeToken: s.flyHomeToken + 1 })),
  focus: null,
  focusStation: (geo) => set({ focus: { lon: geo.lon, lat: geo.lat, token: Date.now() } }),
  searchFocusToken: 0,
  focusSearch: () => set((s) => ({ searchFocusToken: s.searchFocusToken + 1 })),
}));
