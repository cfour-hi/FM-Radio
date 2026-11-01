import { create } from "zustand";
import { readFxId, writeFxId, type FxId } from "../fx/registry";

/*
 * 特效的跨组件信号。
 *
 * MapPage 的「地球层」和粒子场景层是兄弟结构，FxSwitcher 在更外层的按钮排里，
 * 三者没有直接的父子关系——和 flyHomeToken 一样，靠 zustand 存状态，
 * 谁改谁写盘。特效选择比 flyHome 多一层持久化：刷新之后应该停在用户
 * 上次选的特效里，而不是每次都从地球开始。
 */

type FxState = {
  /** 当前特效；globe 是地图本体，其余为粒子场景 */
  fxId: FxId;
  /** 粒子场景里要不要画可点的电台点（关掉就是纯氛围壁纸） */
  showStations: boolean;
  setFx: (id: FxId) => void;
  toggleStationDots: () => void;
};

export const useFxStore = create<FxState>((set, get) => ({
  fxId: readFxId(),
  showStations: true,
  setFx: (id) => {
    if (get().fxId === id) return;
    writeFxId(id);
    set({ fxId: id });
  },
  toggleStationDots: () => {
    set({ showStations: !get().showStations });
  },
}));
