import { useRef, type RefObject } from "react";
import type { Station } from "../lib/types";

/*
 * 粒子特效之间共享的「电台点」基建。
 *
 * 每个特效都要回答同样三个问题：取哪些台（有坐标、按点击量截上限）、
 * 画成什么颜色（真实坐标暖金 / 推断坐标冷蓝，沿用地图的双色隐喻）、
 * 点了怎么算命中（14px 半径、按距离排序、多个一起交出去）。
 * 答案只写这一份，各特效只负责自己的投影和画法。
 */

/** 单个特效的电台点上限：4216 个全画偏重，按点击量取前一批 */
export const STATION_DOT_LIMIT = 1500;

/** 命中半径：与地图 hitTest 一致，两个世界「点得中」的手感应该一样 */
export const HIT_RADIUS = 14;

/** 真实坐标暖金 / 推断坐标冷蓝，与地图 station-dot / station-approx 同色 */
export const WARM: [number, number, number] = [240, 166, 60];
export const COLD: [number, number, number] = [90, 169, 201];

/** 投影前的点种子：sid + 通用观感字段 + 原始经纬度，各特效再补自己的坐标字段 */
export type StationDotSeed = {
  sid: string;
  /** 相对亮度 0–1，按点击量 sqrt 归一 */
  glow: number;
  color: [number, number, number];
  lon: number;
  lat: number;
};

/** 按点击量截取有坐标的台，归一化亮度、按坐标精度分色 */
export function selectStationDots(stations: Station[]): StationDotSeed[] {
  const pool = stations
    .filter((s) => s.geo)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, STATION_DOT_LIMIT);
  const maxClicks = pool[0]?.clicks ?? 0;
  return pool.map((s) => ({
    sid: s.id,
    glow: maxClicks > 0 ? Math.sqrt(s.clicks / maxClicks) : 0.5,
    color: s.geoApprox ? COLD : WARM,
    lon: s.geo!.lon,
    lat: s.geo!.lat,
  }));
}

/**
 * 点击命中：返回半径内的 sid，按离点击点的距离排序。
 *
 * 落点读的是各特效每帧记下的屏幕坐标——极坐标/归一化坐标反解不出
 * 屏幕位置（旋转、浮动都会挪动落点），直接量距离最可靠。
 */
export function pickDots(
  dots: readonly { x: number; y: number; sid: string }[],
  px: number,
  py: number,
  radius: number,
): string[] {
  const hits: { sid: string; d: number }[] = [];
  for (const dot of dots) {
    const d = Math.hypot(dot.x - px, dot.y - py);
    if (d <= radius) hits.push({ sid: dot.sid, d });
  }
  return hits.sort((a, b) => a.d - b.d).map((h) => h.sid);
}

/**
 * 点击 → 播放的处理钩子。
 *
 * 屏幕坐标 → sid → 台的换算每个特效都一样，收成一个 hook：
 * 各组件只留 ref 和回调，命中逻辑不再有第二份副本。
 */
export function useFxStationPick<T extends { x: number; y: number; sid: string }>(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  dotsRef: RefObject<T[]>,
  stationsRef: RefObject<Station[]>,
  showRef: RefObject<boolean>,
  onPickStations: (picked: Station[]) => void,
): (event: React.MouseEvent<HTMLDivElement>) => void {
  const pickRef = useRef(onPickStations);
  pickRef.current = onPickStations;

  return (event) => {
    if (!showRef.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sids = pickDots(dotsRef.current, event.clientX - rect.left, event.clientY - rect.top, HIT_RADIUS);
    if (sids.length === 0) return;
    const byId = new Map(stationsRef.current.map((s) => [s.id, s]));
    const picked = sids.map((sid) => byId.get(sid)).filter((s): s is Station => Boolean(s));
    if (picked.length > 0) pickRef.current(picked);
  };
}
