/*
 * radio-browser 拉取与清洗的共享工具。
 *
 * build-stations.mjs（生成快照）和 check-streams.mjs（抽查流）共用同一套
 * 镜像轮换、https 硬过滤、坐标校验与受限并发；逻辑只留一份。
 */

export const MIRRORS = [
  "de2.api.radio-browser.info",
  "fi1.api.radio-browser.info",
  "de1.api.radio-browser.info",
  "all.api.radio-browser.info",
];

/** 当前镜像。get() 失败时在这里轮换，模块级可变，全脚本共享。 */
let mirror = MIRRORS[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(path, params = {}, attempt = 0) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ""),
  ).toString();
  const url = `https://${mirror}${path}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FM-Radio-MapBuild/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    // 换一个镜像再试：单个镜像偶尔会 5xx
    mirror = MIRRORS[(MIRRORS.indexOf(mirror) + 1) % MIRRORS.length];
    await sleep(600 * (attempt + 1));
    return get(path, params, attempt + 1);
  }
}

export const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * 与 src/lib/normalize.ts 保持同一套判据。
 * 改这里之前先看那边的注释：接口会用 0 表示「未填写」，而且经常只填一边。
 */
export function geoOf(raw) {
  const lat = num(raw.geo_lat);
  const lon = num(raw.geo_long);
  if (lat === 0 || lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/**
 * 把一条原始记录收敛成 station 对象。
 *
 * 只收 https 台（混合内容在页面里放不了）。allowNoGeo 为真时无坐标也收，
 * 给中国台和「无坐标但可播」的搜索目录用——它们上不了图，但还能播。
 * 返回 null 表示这条不该进产物。
 */
export function pick(raw, { allowNoGeo = false } = {}) {
  const url = text(raw.url_resolved) || text(raw.url);
  if (!url.startsWith("https://")) return null;
  const geo = geoOf(raw);
  if (!geo && !allowNoGeo) return null;
  const id = text(raw.stationuuid);
  if (!id) return null;
  return {
    id,
    name: text(raw.name) || "未命名电台",
    url,
    countryCode: text(raw.countrycode).toUpperCase(),
    countryName: text(raw.country),
    state: text(raw.state),
    languages: text(raw.language),
    tags: text(raw.tags),
    codec: (text(raw.codec) || "UNKNOWN").toUpperCase(),
    bitrate: num(raw.bitrate),
    clicks: num(raw.clickcount),
    hls: raw.hls === 1 || raw.hls === true,
    sslError: Boolean(text(raw.ssl_error)),
    lat: geo?.lat ?? null,
    lon: geo?.lon ?? null,
    homepage: text(raw.homepage),
    favicon: text(raw.favicon),
    /** 归属字段由 resolveStation / inferChinaGeo 填，默认空 */
    province: null,
    provinceCode: null,
    city: null,
  };
}

const EARTH_R = Math.PI / 180;

/** 两点间的大圆距离，单位「度」。够用来判断两个坐标是不是在同一片大陆上。 */
function degreesBetween(a, b) {
  const dLat = (a.lat - b.lat) * EARTH_R;
  const dLon = (a.lon - b.lon) * EARTH_R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * EARTH_R) * Math.cos(b.lat * EARTH_R) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / EARTH_R;
}

/**
 * 剔除「地理上不可能」的点。
 *
 * 判据是同国点位的「最近邻距离」：标错大洲的点离最近的同国台有几千公里。
 * 阈值取 max(15°, 该国中位数 × 8)。国家点位数少于 4 时没有足够样本，一律保留。
 * 返回 { keep: Set<id>, dropped: [...] }。
 */
export function dropOutliers(stations) {
  const byCountry = new Map();
  for (const s of stations) {
    const code = s.countryCode || "??";
    const list = byCountry.get(code);
    if (list) list.push(s);
    else byCountry.set(code, [s]);
  }

  const keep = new Set();
  const dropped = [];

  for (const [code, list] of byCountry) {
    if (list.length < 4) {
      for (const s of list) keep.add(s.id);
      continue;
    }

    const nearest = list.map((a, i) => {
      let min = Infinity;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const d = degreesBetween(a, list[j]);
        if (d < min) min = d;
      }
      return min;
    });

    const sorted = [...nearest].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const limit = Math.max(15, median * 8);

    list.forEach((s, i) => {
      if ((nearest[i] ?? 0) > limit) dropped.push({ code, station: s, gap: nearest[i], limit });
      else keep.add(s.id);
    });
  }

  return { keep, dropped };
}

/** 受限并发地执行 fn，返回与原数组同序的结果。 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
