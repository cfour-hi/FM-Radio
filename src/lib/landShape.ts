import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

/*
 * 陆地多边形。
 *
 * 这份数据是地图上唯一的地理信息：没有国界、没有省界、没有海岸描边，
 * 只有一块块「这里是陆地」的面。粒子负责质感，它负责体积——纯黑底上
 * 撒一层点，球会散成漂浮的点云，立不起来。
 *
 * 数据由 scripts/build-land-shape.mjs 在构建期生成（127 个多边形，gzip 34KB）。
 * 取不到就当没有：陆地面塌了地图还能用，只是球体会薄一些，
 * 不值得为它抛错挡住整页。
 */

type Snapshot = {
  v: number;
  source: string;
  features: { type: "Feature"; properties: Record<string, never>; geometry: Polygon | MultiPolygon }[];
};

const FILE = "land.json";

let pending: Promise<FeatureCollection<Polygon | MultiPolygon> | null> | null = null;

export function loadLandShape(): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  pending ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${FILE}`);
      if (!res.ok) return null;
      const snapshot = (await res.json()) as Snapshot;
      if (!Array.isArray(snapshot.features) || snapshot.features.length === 0) return null;
      return { type: "FeatureCollection", features: snapshot.features };
    } catch {
      return null;
    }
  })();

  return pending;
}
