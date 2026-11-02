import { countryNameOf } from "./countryNames";
import type { Station } from "./types";

/*
 * 快照行 → Station。
 *
 * 快照是列式、位置式的，只能追加列；这里对每一列都做长度守卫，旧快照
 * （20/7 列）解码时新字段自然落到 null / []。抽成独立模块是为了能在
 * Node 测试里直接喂 fixture，不必解析 Vite 的 `?url` 导入。
 */

export const tokens = (value: unknown): string[] =>
  typeof value === "string"
    ? [...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))]
    : [];

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const number = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/** 24 列地图行（兼容旧的 18 / 20 列）→ Station。列序见 build-stations.mjs 的 FIELDS。 */
export function decodeMapRows(rows: (string | number)[][]): Station[] {
  const out: Station[] = [];
  for (const row of rows) {
    if (row.length < 10) continue;
    const lat = number(row[7]);
    const lon = number(row[8]);
    const url = text(row[2]);
    // 快照里不会出现这些情况，但地图数据一旦脏了，坏点是很难看出来的
    if (!url.startsWith("https://")) continue;
    if (lat === 0 || lon === 0) continue;
    const countryCode = text(row[3]).toUpperCase();
    out.push({
      id: text(row[0]),
      name: text(row[1]),
      url,
      homepage: text(row[20]) || null,
      favicon: text(row[21]) || null,
      countryCode,
      // 保留接口里的原始英文国名，搜索 "france" 仍能命中；显示时再本地化
      countryName: text(row[4]),
      state: text(row[12]) || null,
      languages: tokens(row[18]),
      tags: tokens(row[19]),
      pinyinName: tokens(row[22]),
      pinyinPlace: tokens(row[23]),
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

/** 11 列 catalog 行（兼容旧的 5 / 7 列）→ Station（无坐标、无省市，仅用于搜索与播放）。 */
export function decodeCatalogRows(rows: (string | number)[][]): Station[] {
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
      homepage: text(row[7]) || null,
      favicon: text(row[8]) || null,
      countryCode,
      countryName: countryNameOf(countryCode),
      state: null,
      languages: tokens(row[5]),
      tags: tokens(row[6]),
      pinyinName: tokens(row[9]),
      pinyinPlace: tokens(row[10]),
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
