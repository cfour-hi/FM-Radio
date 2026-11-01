import { Point, type Map as MlMap } from "maplibre-gl";
import type { Station } from "../lib/types";
import { LAYER } from "./style";

/*
 * 「这个位置上有哪些台」只有一种答案。
 *
 * 点击和悬停必须共用同一份判定，否则会出现「提示条写着 A、点开却是 B」——
 * 这种不一致比不显示提示更让人不信任。所以两处都调这里。
 */

/** 外部只提供屏幕坐标，不必关心 MapLibre 的点类型 */
type ScreenPoint = { x: number; y: number };

/**
 * 必须换成真正的 `Point` 实例再交给 MapLibre。
 *
 * `queryRenderedFeatures` 用 `instanceof Point || Array.isArray()` 区分「第一个
 * 参数是几何还是 options」。传一个长得像点的普通 `{x, y}` 对象，它会被当成
 * options，几何退化成整个视口——于是「这一带 N 个台」会算成全屏的台数，
 * 而且不报任何错。(maplibre-gl 5.x `map.queryRenderedFeatures`)
 */
function toPoint(p: ScreenPoint): Point {
  return p instanceof Point ? p : new Point(p.x, p.y);
}

export type HitResult = {
  /** 按 label → 光点 的顺序去重后的台 */
  stations: Station[];
  /** 命中了台名文字本身（比光点更精确，优先级更高） */
  fromLabel: boolean;
};

/** 命中候选超过这个数就不再逐个投影算距离——全球视角下中国一片能一次进圈几百个 */
const DISTANCE_CANDIDATE_LIMIT = 40;

export function stationsAtPoint(
  map: MlMap,
  point: ScreenPoint,
  byId: Map<string, Station>,
): HitResult {
  // 台名的命中框就是文字本身，很窄；光点层半径 14px。先查文字再查光点。
  const at = toPoint(point);
  const labelFeatures = map.queryRenderedFeatures(at, { layers: [LAYER.label] });
  const hitFeatures = map.queryRenderedFeatures(at, { layers: [LAYER.hit] });

  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const feature of [...labelFeatures, ...hitFeatures]) {
    const sid = feature.properties?.["sid"] as string | undefined;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const station = byId.get(sid);
    if (station) stations.push(station);
  }
  return { stations, fromLabel: labelFeatures.length > 0 };
}

/**
 * 命中多个台时显示哪一个。
 *
 * 规则与点击后的行为对齐：点击会打开「这一带 N 个台」列表，列表按 label →
 * 光点的顺序排，所以提示条显示的必须是同一个，用户才会觉得「看到的就是点到的」。
 */
export function pickPrimary(hit: HitResult, map: MlMap, point: ScreenPoint): Station | null {
  if (hit.stations.length === 0) return null;
  if (hit.stations.length === 1) return hit.stations[0]!;

  // 台名命中时，第一个就是列表首行
  if (hit.fromLabel) return hit.stations[0]!;

  if (hit.stations.length > DISTANCE_CANDIDATE_LIMIT) {
    // 太密了，逐个投影不值得：直接取点击量最高的那个
    return hit.stations.reduce((best, s) => (s.clicks > best.clicks ? s : best), hit.stations[0]!);
  }

  let best = hit.stations[0]!;
  let bestDistance = Infinity;
  for (const station of hit.stations) {
    if (!station.geo) continue;
    const projected = map.project([station.geo.lon, station.geo.lat]);
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = station;
    }
  }
  return best;
}
