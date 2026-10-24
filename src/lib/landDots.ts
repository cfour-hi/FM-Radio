import type { FeatureCollection, MultiPoint } from "geojson";

/*
 * 大陆粒子点阵。
 *
 * 这是整张地图上最「地理」的一层：用细密的点把陆地铺出来，让世界看起来
 * 像一片发光的地表。它不参与任何命中判断，也不表达国界——这张图上根本没有
 * 国界，只有陆地和海洋，以及电台点。
 *
 * 数据由 scripts/build-land-dots.mjs 在构建期生成（13109 个点，gzip 58KB）。
 * 加载失败不该影响地图可用性，调用方拿到 null 就当没有这一层。
 */

type Snapshot = { v: number; n: number; pts: number[] };

/*
 * 两套点阵，因为 2D 平面和 3D 球需要不同空间里采样的点：
 *
 * - land-dots.json        墨卡托网格，给平面地图
 * - land-dots-globe.json  球面均匀，给 globe 投影
 *
 * 用错会非常明显：球面采样铺在平面上会出一圈圈同心弧，
 * 墨卡托网格铺在球上会把两极挤成条纹。两个文件都由
 * scripts/build-land-dots.mjs 生成。
 */
const PLANE_FILE = "land-dots.json";
const GLOBE_FILE = "land-dots-globe.json";

/** 按文件分别缓存：两边都加载时不能互相顶掉 */
const cache = new Map<string, Promise<LandDots | null>>();

export type LandDots = FeatureCollection<MultiPoint>;

export function loadLandDots(file: string = PLANE_FILE): Promise<LandDots | null> {
  const cached = cache.get(file);
  if (cached) return cached;

  /*
   * 这里故意不抛错。粒子是锦上添花，取不到就当没有，
   * 让地图照常出——比因为一层装饰图失败而整页报错要合理。
   */
  const promise = (async (): Promise<LandDots | null> => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
      if (!res.ok) return null;
      const snapshot = (await res.json()) as Snapshot;
      if (!Array.isArray(snapshot.pts) || snapshot.pts.length < 2) return null;

      /*
       * 打包成一个 MultiPoint，而不是一万多个 Feature。
       * 数据量一样，但省掉了上万个对象的构造和序列化——
       * 这些开销全在首帧里，用户能感觉到。
       */
      const coords: [number, number][] = [];
      const pts = snapshot.pts;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        coords.push([(pts[i] as number) / 100, (pts[i + 1] as number) / 100]);
      }

      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "MultiPoint", coordinates: coords },
            properties: {},
          },
        ],
      };
    } catch {
      return null;
    }
  })();

  cache.set(file, promise);
  return promise;
}

/** 球面版点阵；globe 投影下用它 */
export function loadGlobeDots(): Promise<LandDots | null> {
  return loadLandDots(GLOBE_FILE);
}
