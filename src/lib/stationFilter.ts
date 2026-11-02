import { checkSupport } from "./capability";
import type { Station } from "./types";

/**
 * 能不能参与推荐、随机和自动换台。
 *
 * 判据只有三条：浏览器格式支持、证书没问题、没有被本地隐藏。
 * 搜索和收藏不强制过滤——用户明确要看的列表不应该被悄悄清掉。
 */
export function isPlayable(station: Station, hidden: ReadonlySet<string>): boolean {
  return !hidden.has(station.id) && !station.sslError && checkSupport(station).ok;
}

export function filterPlayable(stations: Station[], hidden: ReadonlySet<string>): Station[] {
  return stations.filter((station) => isPlayable(station, hidden));
}
