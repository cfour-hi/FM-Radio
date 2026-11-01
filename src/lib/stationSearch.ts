import { regionLabel } from "./cnEnrichment";
import type { Station } from "./types";

/*
 * 台名搜索之外，还要能按「地方」找。
 *
 * 「听湖南的台」和「听法国的台」是这个产品里最自然的两种诉求，可数据里
 * 台名往往只有呼号（"BBC Radio 4"、"湖南交通广播"）。所以索引里除名字外
 * 再挂一份地区词：省、市、州省、国家名、国家代码，以及「中国香港」这类
 * 展示名——用户看到的是那个写法，搜的时候就会照那个写法打。
 */

type Entry = { station: Station; name: string; region: string[] };

// 旧接口的索引：只按台名，保持与 tests/stationSearch.test.mjs 的逐条一致
const indexes = new WeakMap<Station[], { station: Station; name: string }[]>();
const richIndexes = new WeakMap<Station[], Entry[]>();

/** 大小写不敏感 + 去掉变音符号（é → e），否则搜 "sao" 找不到 "São" */
export const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * 国家代码 → 中文国名。
 *
 * 用 Intl.DisplayNames 而不是维护一张几十条的中英对照表：语言包跟着浏览器
 * 走，永远不会漏国家，也不会写错。运行环境不支持时返回空串，搜索退化为
 * 英文国名与国家代码。
 *
 * 港澳台不走 Intl：语言包给的是「中国香港特别行政区」「台湾」这类写法，
 * 既啰嗦又不合规范。这三地的中文名由 regionLabel 统一给出，和数据里的
 * 省名是同一套。
 */
const CN_SPECIAL: Record<string, string> = { HK: "香港", MO: "澳门", TW: "台湾" };

let displayNames: Intl.DisplayNames | null | undefined;
function countryNameOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const special = CN_SPECIAL[code.toUpperCase()];
  if (special) return regionLabel(special);
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  try {
    const name = displayNames?.of(code.toUpperCase());
    // 未知代码会原样返回代码本身，那不算国名
    return name && name.toUpperCase() !== code.toUpperCase() ? name : "";
  } catch {
    return "";
  }
}

function regionTokens(station: Station): string[] {
  const tokens: (string | null | undefined)[] = [
    station.province,
    station.city,
    station.state,
    station.countryName,
    countryNameOf(station.countryCode),
    station.countryCode,
  ];
  if (station.province) {
    // 展示名与数据值可能不同：数据里是「香港」，界面上写「中国香港」
    tokens.push(regionLabel(station.province));
    if (station.city && station.city !== station.province) {
      tokens.push(`${station.province}${station.city}`);
    }
  }
  return tokens.filter((token): token is string => Boolean(token)).map(fold);
}

function buildRichIndex(stations: Station[]): Entry[] {
  const index = stations
    .map((station) => ({ station, name: fold(station.name), region: regionTokens(station) }))
    .sort((a, b) => b.station.clicks - a.station.clicks);
  richIndexes.set(stations, index);
  return index;
}

export type SearchResult = {
  hits: Station[];
  /** 地区命中的总数（hits 里只放了前 regionLimit 个） */
  regionTotal: number;
};

/*
 * 匹配分三层，优先级从高到低：
 *   0 台名前缀   1 台名包含   2 地区前缀
 *
 * 地区匹配只在关键词至少两个字时开启：单个字母会命中半个地球，那种结果
 * 对谁都没用。地区命中另设上限并回传总数，界面写清「共 N 个台，显示前 M 个」，
 * 免得用户以为这就是全部。
 */
export function searchStations(
  stations: Station[],
  q: string,
  opts: { limit?: number; regionLimit?: number } = {},
): SearchResult {
  const limit = opts.limit ?? 50;
  const regionLimit = opts.regionLimit ?? 30;
  const needle = fold(q);
  if (!needle || limit <= 0) return { hits: [], regionTotal: 0 };

  const index = richIndexes.get(stations) ?? buildRichIndex(stations);
  const allowRegion = needle.length >= 2;

  const matched: { station: Station; tier: number; order: number }[] = [];
  let regionTotal = 0;

  for (let order = 0; order < index.length; order++) {
    const entry = index[order]!;
    let tier = -1;
    if (entry.name.startsWith(needle)) tier = 0;
    else if (entry.name.includes(needle)) tier = 1;
    else if (allowRegion && entry.region.some((token) => token.startsWith(needle))) {
      tier = 2;
      regionTotal++;
    }
    if (tier >= 0) matched.push({ station: entry.station, tier, order });
  }

  // 索引本身按点击量降序，同层内保持索引序就仍是热度序
  matched.sort((a, b) => a.tier - b.tier || a.order - b.order);

  const named = matched.filter((item) => item.tier <= 1);
  const regional = matched.filter((item) => item.tier === 2).slice(0, regionLimit);

  return {
    hits: [...named, ...regional].slice(0, limit).map((item) => item.station),
    regionTotal,
  };
}

/* ------------------------------------------------------------------ */

// 分片是不可变快照。每份数组只排序、规范化一次，旧快照释放后索引也可回收。
export function searchByName(stations: Station[], q: string, limit = 50): Station[] {
  const needle = q.trim().toLowerCase();
  if (!needle || limit <= 0) return [];
  let index = indexes.get(stations);
  if (!index) {
    index = stations
      .map((station) => ({ station, name: station.name.toLowerCase() }))
      .sort((a, b) => b.station.clicks - a.station.clicks);
    indexes.set(stations, index);
  }
  const hits: Station[] = [];
  for (const entry of index) {
    if (!entry.name.includes(needle)) continue;
    hits.push(entry.station);
    if (hits.length >= limit) break;
  }
  return hits;
}
