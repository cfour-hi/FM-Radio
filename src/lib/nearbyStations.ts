import type { Geo, Station } from "./types";

export function validGeo(geo: Geo): boolean {
  return Number.isFinite(geo.lat) && Number.isFinite(geo.lon) &&
    Math.abs(geo.lat) <= 90 && Math.abs(geo.lon) <= 180;
}

/** 球面大圆距离（公里），不依赖在线地图或反向地理编码。 */
export function distanceKm(from: Geo, to: Geo): number {
  const rad = Math.PI / 180;
  const a = Math.sin((to.lat - from.lat) * rad / 2) ** 2 +
    Math.cos(from.lat * rad) * Math.cos(to.lat * rad) *
    Math.sin((to.lon - from.lon) * rad / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export type NearbyStation = { station: Station; distance: number };

/** 最多展示最近 50 个台；无有效坐标的台仍可通过搜索或手动地区找到。 */
export function nearestStations(stations: Station[], origin: Geo, limit = 50): NearbyStation[] {
  if (!validGeo(origin) || limit <= 0) return [];
  const candidates: NearbyStation[] = [];
  for (const station of stations) {
    if (!station.geo || !validGeo(station.geo)) continue;
    candidates.push({ station, distance: distanceKm(origin, station.geo) });
  }
  candidates.sort((a, b) => a.distance - b.distance || b.station.clicks - a.station.clicks);
  return candidates.slice(0, limit);
}

/** 距离不使用小数；电台或用户坐标较粗略时按十公里取整，并明确标记估算。 */
export function nearbyDistanceLabel(item: NearbyStation, accuracy: number): string {
  const approximate = item.station.geoApprox || item.station.geoPrecision === "province";
  const step = approximate || accuracy >= 1000 ? 10 : 1;
  const distance = item.distance < step
    ? `小于 ${step} 公里`
    : `约 ${Math.round(item.distance / step) * step} 公里`;
  const note = item.station.geoPrecision === "province" ? "省级位置估算" : "位置为估算";
  return approximate ? `${distance} · ${note}` : distance;
}

export function accuracyLabel(meters: number): string {
  return meters < 1000 ? `约 ${Math.max(1, Math.ceil(meters / 10) * 10)} 米` : `约 ${Math.ceil(meters / 1000)} 公里`;
}
