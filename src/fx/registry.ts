/*
 * 特效注册表。
 *
 * 「地球」是默认特效（MapLibre 球体，一直都在），其余是纯 Canvas 粒子场景。
 * registry 只负责两件事：声明有哪些特效、把用户的选择在 localStorage 里
 * 存取干净。每个 Canvas 特效的实体在 src/fx/ 下各自的组件文件里，
 * registry 不 import 它们——保持这个模块可以在测试里单独加载。
 */

export type FxId = "globe" | "galaxy" | "tunnel" | "aurora";

export type FxDef = {
  id: FxId;
  /** 菜单里的名字 */
  name: string;
  /** HUD 读数位显示的一句短说明 */
  hint: string;
  /** 切到这个特效时，右上角按钮的 aria-label */
  aria: string;
};

/** 顺序即菜单顺序，第一项是默认 */
export const FX_LIST: readonly FxDef[] = [
  { id: "globe", name: "地球", hint: "世界电台地图", aria: "切换特效" },
  { id: "galaxy", name: "银河", hint: "银河旋臂 · 每个光点是一个电台", aria: "切换特效" },
  { id: "tunnel", name: "星流", hint: "星流穿越 · 光点掠过眼前", aria: "切换特效" },
  { id: "aurora", name: "极光", hint: "极光流 · 电台缓缓漂移", aria: "切换特效" },
] as const;

export const DEFAULT_FX: FxId = "globe";

const FX_KEY = "fm-radio.fx.v1";

function isFxId(value: unknown): value is FxId {
  return FX_LIST.some((fx) => fx.id === value);
}

/** 读取上次选择的特效；隐私模式、损坏值都回落到默认 */
export function readFxId(): FxId {
  try {
    const raw = localStorage.getItem(FX_KEY);
    return isFxId(raw) ? raw : DEFAULT_FX;
  } catch {
    return DEFAULT_FX;
  }
}

export function writeFxId(id: FxId): void {
  try {
    localStorage.setItem(FX_KEY, id);
  } catch {
    /* 隐私模式下写不进去：本次会话仍可切换，刷新后回默认 */
  }
}
