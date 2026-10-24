import { create } from "zustand";

/*
 * 地图的跨组件信号。
 *
 * 首页就是地图，顶栏的 logo 和地图右上角的「回到世界」按钮要做同一件事：
 * 把镜头飞回全球视角。Header 和 MapPage 是兄弟组件，没有直接的父子关系，
 * 靠 zustand 存一个递增的 token，谁点谁 +1，MapPage 读到变化就把视角复位。
 */

type MapState = {
  /** 每次「回到世界」都 +1，MapPage 监听它的变化触发 fitWorld */
  flyHomeToken: number;
  flyHome: () => void;
};

export const useMapStore = create<MapState>((set) => ({
  flyHomeToken: 0,
  flyHome: () => set((s) => ({ flyHomeToken: s.flyHomeToken + 1 })),
}));
