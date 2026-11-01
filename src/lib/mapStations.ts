import { countryNameOf } from "./countryNames";
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

const tokens = (value: unknown): string[] => typeof value === "string" ? [...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))] : [];

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const number = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/** 20 列地图行（兼容旧 18 列） → Station。列序见 build-stations.mjs 的 FIELDS。 */
function decodeMapRows(rows: (string | number)[][]): Station[] {
  const out: Station[] = [];
  for (const row of rows) {
    if (row.length < 10) continue;
    const lat = number(row[7]);
    const lon = number(row[8]);
    const url = text(row[2]);
    // 快照里不会出现这些情况，但地图数据一旦脏了，坏点是很难看出来的
    if (!url.startsWith("https://")) continue;
    if (lat === 0 || lon === 0) continue;
    out.push({
      id: text(row[0]),
      name: text(row[1]),
      url,
      homepage: null,
      favicon: null,
      countryCode: text(row[3]).toUpperCase(),
      countryName: text(row[4]),
      state: text(row[12]) || null,
      languages: tokens(row[18]),
      tags: tokens(row[19]),
      codec: text(row[5]) || "UNKNOWN",
      bitrate: number(row[6]),
      votes: 0,
      clicks: number(row[9]),
      geo: { lat, lon },
      geoApprox: number(row[13]) === 1,
      place: text(row[14]) || null,
      lastCheckOk: true,
      hls: number(row[10]) === 1,
      sslError: number(row[11]) === 1,
      province: text(row[15]) || null,
      city: text(row[16]) || null,
      geoPrecision: row[17] === 1 ? "province" : row[17] === 0 ? "city" : null,
    });
  }
  return out;
}

/** 7 列 catalog 行（兼容旧 5 列） → Station（无坐标、无省市，仅用于搜索与播放）。 */
function decodeCatalogRows(rows: (string | number)[][]): Station[] {
  const out: Station[] = [];
  for (const row of rows) {
    if (row.length < 5) continue;
    const url = text(row[4]);
    if (!url.startsWith("https://")) continue;
    const countryCode = text(row[2]).toUpperCase();
    out.push({
      id: text(row[0]),
      name: text(row[1]),
      url,
      homepage: null,
      favicon: null,
      countryCode,
      countryName: countryNameOf(countryCode),
      state: null,
      languages: tokens(row[5]),
      tags: tokens(row[6]),
      codec: "UNKNOWN",
      bitrate: 0,
      votes: 0,
      clicks: number(row[3]),
      geo: null,
      geoApprox: false,
      place: null,
      lastCheckOk: true,
      hls: false,
      sslError: false,
      province: null,
      city: null,
      geoPrecision: null,
    });
  }
  return out;
}

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
