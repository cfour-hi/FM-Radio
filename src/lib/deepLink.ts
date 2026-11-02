/*
 * 分享单个电台用的 URL 参数。
 *
 * 用 query 而不是 /s/:id 路径：站点是纯静态托管（没有 SPA fallback），
 * `?s=` 落到 index.html 上天然可用，而路径形式刷新就会 404。
 */

export const STATION_PARAM = "s";
export const COUNTRY_PARAM = "c";
export const PROVINCE_PARAM = "p";

/** 台 id 是 radio-browser 的 uuid，只可能由这些字符组成；不合法就当作没有 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function readStationId(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search).get(STATION_PARAM);
  if (!raw) return null;
  const id = raw.trim();
  return ID_PATTERN.test(id) ? id : null;
}

/** 分享「某个国家/地区」用的两位国家代码；不合法返回 null。 */
export function readCountryCode(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search).get(COUNTRY_PARAM)?.trim() ?? "";
  return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
}

/** 省份/州名；只做长度与尖括号校验，具体是否存在交给浏览视图处理。 */
export function readProvince(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search).get(PROVINCE_PARAM)?.trim() ?? "";
  if (!raw || raw.length > 20 || /[<>]/.test(raw)) return null;
  return raw;
}

/**
 * 生成「打开就播这个台」的链接。
 *
 * 只摘掉 guide（那是调试用的，不该跟着分享出去），其它参数原样保留——
 * 发布平台的 sharecode 就在里面，删了别人打不开。
 */
export function buildStationUrl(
  id: string,
  href: string = typeof window === "undefined" ? "https://example.invalid/" : window.location.href,
): string {
  const url = new URL(href);
  url.hash = "";
  const params = new URLSearchParams(url.search);
  params.delete("guide");
  params.set(STATION_PARAM, id);
  url.search = params.toString();
  return url.toString();
}
