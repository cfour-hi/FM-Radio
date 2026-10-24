import type { Station } from "./types";

/*
 * 「附近」tab 的数据来源：从本地分片里按省市筛，不再走实时 API。
 *
 * 地图做首页后，中国台的省市已经随 core 分片直接下发（scripts/build-stations.mjs
 * 里 inferChinaGeo 算好），这里只按用户手动选择的地区做纯内存筛选，
 * 离线可用、与地图上的点完全一致。
 */

export type LocalGroups = {
  /** 本市（调用方明确提供城市时） */
  city: Station[];
  /** 省会 */
  capital: Station[];
  /** 省内其他 */
  rest: Station[];
};

const byClicks = (a: Station, b: Station) => b.clicks - a.clicks;

/**
 * 把省内的台分成「本市 / 省会 / 其他」三桶。
 *
 * 直辖市（北京 / 上海…）城市和省会同名，city 与 capital 相等时就不再
 * 单列本市——否则同一个台会同时落进两桶。
 */
export function buildLocalGroups(
  stations: Station[],
  province: string,
  city: string | null,
  capital: string,
): LocalGroups {
  const cityKey = city && city !== capital ? city : null;
  const cityGroup: Station[] = [];
  const capitalGroup: Station[] = [];
  const restGroup: Station[] = [];

  for (const s of stations) {
    if (s.province !== province) continue;
    if (cityKey && s.city === cityKey) cityGroup.push(s);
    else if (capital && s.city === capital) capitalGroup.push(s);
    else restGroup.push(s);
  }

  cityGroup.sort(byClicks);
  capitalGroup.sort(byClicks);
  restGroup.sort(byClicks);
  return { city: cityGroup, capital: capitalGroup, rest: restGroup };
}

/** 附近三桶合起来，按「本市 → 省会 → 省内」顺序排成一份播放队列。 */
export function nearbyQueue(groups: LocalGroups): Station[] {
  return [...groups.city, ...groups.capital, ...groups.rest];
}
