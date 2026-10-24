/*
 * 中国省级行政区展示名的纯函数工具。
 *
 * 归属数据本身不再靠一份独立的 cn-enrichment.json——那是在列表页时代
 * 「实时 API 拉台 + 查表补省市」用的。地图做首页后，省市已经随 core 分片
 * 的每条台直接下发（scripts/build-stations.mjs 里 inferChinaGeo 算好），
 * 这里只保留不依赖任何数据文件的展示与地区映射：
 *   - regionLabel     港澳台的展示名（香港 → 中国香港）
 *   - countryOfProvince  省 → 接口里的国家代码（港澳台各有一个 code）
 */

/**
 * 港澳台的展示名。
 *
 * 数据里存的是省名（香港 / 澳门 / 台湾），展示时要写全称——
 * 「中国香港」不是修饰，是归属本身，省掉就变成了另一个意思。
 */
const DISPLAY: Record<string, string> = {
  香港: "中国香港",
  澳门: "中国澳门",
  台湾: "中国台湾",
};

export const regionLabel = (province: string): string => DISPLAY[province] ?? province;

/** 省 → 该省台在接口里挂在哪个国家代码下。 */
export function countryOfProvince(province: string): string {
  if (province === "香港") return "HK";
  if (province === "澳门") return "MO";
  if (province === "台湾") return "TW";
  return "CN";
}
