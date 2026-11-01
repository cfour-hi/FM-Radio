import { regionLabel } from "./cnEnrichment";
import type { Station } from "./types";

/*
 * 站点在界面上的展示文本。
 *
 * 抽成独立模块是为了让地图层能单独用它——`hoverTooltip` 需要台名、国旗和
 * 归属，但它不该因此把 `StationRow` 拖进来，那个文件背后连着 player store
 * 和 Dexie，会白白扩大地图的 lazy chunk。
 */

/** 把国家代码转成旗帜；非两位字母就原样返回 */
export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  const chars = [...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...chars);
}

/**
 * 国家名和首个标签经常重复（France / french / france），去重后再拼。
 *
 * 有省市归属的中国台，第一段换成「湖南 · 长沙」，不写国家——
 * 「China」对一个想找本省电台的人没有任何信息量，而省市才是他要的那一栏。
 */
export function stationMeta(station: Station): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const region = regionOf(station);
  const parts = [region || station.countryName || station.countryCode, station.languages[0], station.tags[0]];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * 归属的展示串。
 *
 * 只知道省的时候不写城市：那个城市值是给落点用的省会，写出来就是在
 * 假装我们知道得比实际更多。
 */
export function regionOf(station: Station): string {
  if (!station.province) return "";
  const province = regionLabel(station.province);
  if (station.geoPrecision === "province") return province;
  if (!station.city || station.city === station.province) return province;
  return `${province} · ${station.city}`;
}

/**
 * 归属的完整描述，给地图提示条用。
 *
 * 有省市就用省市；没有就退到州省、国家名、国家代码里第一个非空的——
 * 境外台只有这三个，而 `regionOf` 对中国以外一律返回空串。
 */
export function placeOf(station: Station): string {
  const region = regionOf(station);
  if (region) return region;
  return station.state?.trim() || station.countryName?.trim() || station.countryCode;
}

export type HighlightSegment = { text: string; hit: boolean };

/**
 * 把命中片段切出来，供搜索结果做高亮。
 *
 * 大小写不敏感的代价是「小写后的字符串」与原文可能不同长（极少数字符，
 * 比如 İ）。长度一旦不同，按小写串的位置去切原文就会错位，所以这种情况
 * 直接放弃高亮，整段原样返回——宁可不高亮，也不能把台名切歪。
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];

  const hay = text.toLowerCase();
  if (hay.length !== text.length) return [{ text, hit: false }];

  const out: HighlightSegment[] = [];
  let from = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (at > from) out.push({ text: text.slice(from, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
    at = hay.indexOf(needle, from);
  }
  if (out.length === 0) return [{ text, hit: false }];
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}
