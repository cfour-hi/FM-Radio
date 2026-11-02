import { decodeCatalogRows, decodeMapRows } from "./stationRows";
import type { Station } from "./types";

/*
 * 地图点位分片数据。
 *
 * 数据由 scripts/build-stations.mjs 在构建期拉取 radio-browser 全量生成，
 * 切成三片，落在 src/data/ 下，这里用 Vite 的 `?url` 导入拿到带内容哈希的
 * 文件名。配合 CDN 的 immutable 缓存，新一版发布后用户 0 重复下载。
 *
 *   core    首屏同步：中国全部 + 境外点击量前 3000（能上图）
 *   rest    闲时加载：其余境外有坐标台
 *   catalog 搜索聚焦时懒加载：无坐标的 https 台（能播，但地图上定位不了）
 *
 * 为什么不用 IndexedDB：FM-Radio 是在线听流的，断网时流本身放不出来，
 * 离线缓存一份目录没有意义。HTTP 缓存 + hash 文件名已经足够。
 */

type Snapshot = {
  v: number;
  generatedAt: string;
  source: string;
  stations: (string | number)[][];
};

export type MapDataset = {
  stations: Station[];
  byId: Map<string, Station>;
  generatedAt: string;
  countries: number;
};

/** 手动地区目录所需索引；cityAlias 保留兼容已有快照格式。 */
export type CoreMeta = {
  /** 省 → 省会 */
  capitals: Map<string, string>;
  /** 城市英文名（小写、去符号）→ 候选 [中文名, 省] */
  cityAlias: Map<string, [string, string][]>;
};

export type Core = {
  dataset: MapDataset;
  meta: CoreMeta;
};

import coreUrl from "../data/stations-core.json?url";
import restUrl from "../data/stations-rest.json?url";
import catalogUrl from "../data/stations-catalog.json?url";

function datasetOf(stations: Station[], generatedAt: string): MapDataset {
  return {
    stations,
    byId: new Map(stations.map((s) => [s.id, s])),
    generatedAt,
    countries: new Set(stations.map((s) => s.countryCode).filter(Boolean)).size,
  };
}

async function fetchJson<T extends Snapshot>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`点位数据读取失败（HTTP ${res.status}）`);
  const snapshot = (await res.json()) as T;
  if (!Array.isArray(snapshot.stations)) throw new Error("点位数据格式不对");
  return snapshot;
}

let corePending: Promise<Core> | null = null;

/** 首屏阻塞加载：能上图的 core 台 + 附近/城市索引。 */
export function loadMapCore(): Promise<Core> {
  corePending ??= (async () => {
    const res = await fetch(coreUrl);
    if (!res.ok) throw new Error(`点位数据读取失败（HTTP ${res.status}）`);
    const payload = (await res.json()) as Snapshot & {
      meta?: { capitals?: Record<string, string>; cityAlias?: Record<string, [string, string][]> };
    };
    if (!Array.isArray(payload.stations)) throw new Error("点位数据格式不对");
    const capitals = new Map(Object.entries(payload.meta?.capitals ?? {}));
    const cityAlias = new Map(Object.entries(payload.meta?.cityAlias ?? {}));
    return {
      dataset: datasetOf(decodeMapRows(payload.stations), payload.generatedAt),
      meta: { capitals, cityAlias },
    };
  })().catch((err: unknown) => {
    corePending = null;
    throw err;
  });
  return corePending;
}

let restPending: Promise<MapDataset> | null = null;

/** 闲时加载：其余境外有坐标台。返回的数据集可增量合并进 core 的 byId。 */
export function loadMapRest(): Promise<MapDataset> {
  restPending ??= (async () => {
    const snapshot = await fetchJson<Snapshot>(restUrl);
    return datasetOf(decodeMapRows(snapshot.stations), snapshot.generatedAt);
  })().catch((err: unknown) => {
    restPending = null;
    throw err;
  });
  return restPending;
}

let catalogPending: Promise<Station[]> | null = null;

/** 搜索聚焦时懒加载：无坐标的 https 台（只能听、定位不了）。 */
export function loadMapCatalog(): Promise<Station[]> {
  catalogPending ??= (async () => {
    const snapshot = await fetchJson<Snapshot>(catalogUrl);
    return decodeCatalogRows(snapshot.stations);
  })().catch((err: unknown) => {
    catalogPending = null;
    throw err;
  });
  return catalogPending;
}
