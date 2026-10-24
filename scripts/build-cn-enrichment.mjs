#!/usr/bin/env node
/*
 * 生成「中国电台归属表」：id → 省 / 市 / 线索来源 / 置信度。
 *
 * 这份产物解决的是列表页的问题：列表里的台是浏览器实时从 radio-browser
 * 拉来的，接口不返回省市，前端也没有任何依据去补。构建期算好一张
 * id → 归属的查找表，前端按 id 查一下就能显示「湖南 · 长沙」，还能按省筛。
 *
 * 为什么不复用地图快照：快照按配额只留 260 个中国台，而列表要覆盖
 * 全部 2400 多个——两者用途不同，不能共用一份数据。
 *
 * 产物是紧凑数组不是对象数组：字段名重复两千多次就是几十 KB 的纯开销，
 * 而省名、来源这些字符串高度重复，抽成索引表之后体积能减掉三成。
 *
 * 用法：pnpm cn:enrich
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPITALS } from "./cn-admin.mjs";
import { loadCnGeo, enrichStation } from "./cn-geo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/cn-enrichment.json");
const REPORT = resolve(HERE, "data/cn-enrichment-report.json");

const MIRRORS = [
  "de2.api.radio-browser.info",
  "fi1.api.radio-browser.info",
  "de1.api.radio-browser.info",
  "all.api.radio-browser.info",
];

/**
 * 要富化的国家/地区。
 *
 * 港澳台单列：它们在 radio-browser 里各有自己的 countrycode，
 * 但在归属上是中国的省级行政区，要和大陆的台走进同一张表。
 */
const REGIONS = ["CN", "HK", "MO", "TW"];

const PAGE = 100;
/** 单个地区最多拉这么多页，防止接口异常时无限翻下去 */
const MAX_PAGES = 80;
const CONCURRENCY = 4;

const CONF = ["high", "medium", "low"];

let mirror = MIRRORS[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}, attempt = 0) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ""),
  ).toString();
  const url = `https://${mirror}${path}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FM-Radio-Enrich/1.0" },
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

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v) => (typeof v === "string" ? v.trim() : "");

/** 和 src/lib/normalize.ts 同一套判据：接口会用 0 表示「未填写」。 */
function geoOf(raw) {
  const lat = num(raw.geo_lat);
  const lon = num(raw.geo_long);
  if (lat === 0 || lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function pick(raw) {
  const id = text(raw.stationuuid);
  if (!id) return null;
  const geo = geoOf(raw);
  return {
    id,
    name: text(raw.name) || "未命名电台",
    state: text(raw.state),
    countryCode: text(raw.countrycode).toUpperCase(),
    homepage: text(raw.homepage),
    url: text(raw.url_resolved) || text(raw.url),
    lat: geo?.lat ?? null,
    lon: geo?.lon ?? null,
  };
}

/** 拉一个地区的全量电台。不按点击量截断——富化要覆盖所有台，不是热门台。 */
async function collect(code) {
  const out = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    let rows;
    try {
      rows = await get("/json/stations/search", {
        countrycode: code,
        limit: PAGE,
        offset: page * PAGE,
        hidebroken: "true",
        order: "clickcount",
        reverse: "true",
      });
    } catch (err) {
      console.warn(`  ${code} 第 ${page + 1} 页失败：${err.message}，停止翻页`);
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const raw of rows) {
      const station = pick(raw);
      if (!station || seen.has(station.id)) continue;
      seen.add(station.id);
      out.push(station);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function mapLimit(items, limit, fn) {
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

async function main() {
  const t0 = Date.now();
  const geo = await loadCnGeo();
  console.log(`城市表 ${geo.places.length} 个点，品牌词条 ${geo.brands.length} 条`);

  const perRegion = await mapLimit(REGIONS, CONCURRENCY, async (code) => {
    const rows = await collect(code);
    console.log(`  ${code}：${rows.length} 个台`);
    return rows;
  });

  const stations = perRegion.flat();
  console.log(`合计 ${stations.length} 个台，开始解析归属…`);

  /** 索引表：省名、来源串高度重复，抽出来只存下标 */
  const provinceIdx = new Map();
  const sourceIdx = new Map();
  const provinceList = [];
  const sourceList = [];
  const idx = (map, list, value) => {
    let i = map.get(value);
    if (i === undefined) {
      i = list.length;
      map.set(value, i);
      list.push(value);
    }
    return i;
  };

  const rows = [];
  const byProvince = new Map();
  const bySource = new Map();
  const byConfidence = new Map();
  const citiesOfProvince = new Map();
  const unresolved = [];
  const perRegionCount = new Map();

  for (const station of stations) {
    const r = enrichStation(geo, station);
    const province = r.province?.name ?? "";
    const city = r.city ?? "";

    const key = province || "未归属";
    byProvince.set(key, (byProvince.get(key) ?? 0) + 1);
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
    byConfidence.set(r.confidence, (byConfidence.get(r.confidence) ?? 0) + 1);
    perRegionCount.set(station.countryCode, (perRegionCount.get(station.countryCode) ?? 0) + 1);

    if (!province) {
      // 未归属的也要进表，前端按 id 查不到就当作「无归属」，不必区分
      unresolved.push({
        id: station.id,
        name: station.name,
        state: station.state,
        country: station.countryCode,
        homepage: station.homepage,
        // 写清楚为什么没认出来，人工补词典时按这个分类处理
        reason: station.homepage ? "无地名线索，域名不在词表" : "无地名线索，无主页",
      });
    }

    rows.push([
      station.id,
      province ? idx(provinceIdx, provinceList, province) : -1,
      city,
      idx(sourceIdx, sourceList, r.source),
      CONF.indexOf(r.confidence),
      r.precision === "city" ? 0 : r.precision === "province" ? 1 : 2,
    ]);

    // 省 → 城市分布，用来发现「某个城市把整个省吸走了」这类匹配错误
    if (province) {
      const cities = citiesOfProvince.get(province) ?? new Map();
      const cityKey = city || "（仅到省）";
      cities.set(cityKey, (cities.get(cityKey) ?? 0) + 1);
      citiesOfProvince.set(province, cities);
    }
  }

  /*
   * 城市英文名 → 中文名。
   *
   * IP 归属接口给的是英文（Guangzhou），归属表里存的是中文（广州）。
   * 没有这张反查表，前端就只能显示「你在广东」，「哪个区」永远对不上。
   *
   * 只收 GeoNames 的主名（p.n），不收 p.a 里那几十个别名：一个广州就有
   * 55 种拼法，全收进来这张表会从 9KB 涨到 120KB，而 IP 库用的几乎
   * 总是标准罗马字。同名跨省的（台州 / 泰州 都读 Taizhou）保留全部候选，
   * 由前端按已经认出来的省消歧。
   */
  const knownCities = new Set(rows.map((r) => r[2]).filter(Boolean));
  const cityAlias = {};
  for (const place of geo.places) {
    const zh = place.z;
    if (!zh || !knownCities.has(zh)) continue;
    for (const raw of [place.n, zh]) {
      if (!raw) continue;
      const key = String(raw).toLowerCase().replace(/[^a-z]/g, "");
      if (key.length < 3) continue;
      const list = (cityAlias[key] ??= []);
      if (!list.some((pair) => pair[0] === zh)) list.push([zh, place.pv ?? ""]);
    }
  }

  const payload = {
    v: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "radio-browser.info",
    fields: ["id", "provinceIdx", "city", "sourceIdx", "confidence", "precision"],
    provinces: provinceList,
    /*
     * 和省名同序的省会表。
     *
     * 前端要「优先展示省会的台」，但省会是一份 34 条的行政事实，
     * 不该为了它再引一张表进来——放在这里，长度和 provinces 一样，
     * 下标一一对应，多占不到 300 字节。
     */
    capitals: provinceList.map((name) => CAPITALS[name] ?? ""),
    cityAlias,
    sources: sourceList,
    confidence: CONF,
    rows,
  };

  await mkdir(dirname(OUT), { recursive: true });
  const body = JSON.stringify(payload);
  await writeFile(OUT, body);

  /* ---------------- 报告 ---------------- */

  const total = rows.length;
  const placed = total - unresolved.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  /*
   * 市级 = 真的有城市依据。只认到省的台也带一个省会名（落点需要坐标），
   * 但那不是「知道它在这座城市」，所以单独计数，不能让两个数字互相顶替。
   */
  const cityFilled = rows.filter((r) => r[5] === 0).length;
  const provinceOnly = placed - cityFilled;

  console.log("");
  console.log(
    `省级归属 ${placed}/${total}（${pct(placed)}）：精确到市 ${cityFilled}（${pct(cityFilled)}），` +
      `仅到省 ${provinceOnly}`,
  );
  console.log(`覆盖省级行政区 ${byProvince.size - (byProvince.has("未归属") ? 1 : 0)} 个`);

  console.log("");
  console.log("按地区：");
  for (const [code, n] of [...perRegionCount].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}  ${String(n).padStart(5)}`);
  }

  console.log("");
  console.log("按线索来源：");
  for (const [source, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(source).padEnd(28)} ${String(n).padStart(5)}`);
  }

  console.log("");
  console.log("按置信度：");
  for (const c of CONF) {
    console.log(`  ${c.padEnd(8)} ${String(byConfidence.get(c) ?? 0).padStart(5)}`);
  }

  console.log("");
  console.log("按省份（前 15）：");
  for (const [name, n] of [...byProvince].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    /*
     * 顺带打出这个省里占比最高的城市。
     * 「一个城市占掉全省八成」只有两种可能：要么它真的是这个省的中心，
     * 要么匹配规则把整省的台都吸到了它身上——后者是必须人工看一眼的。
     */
    const cities = citiesOfProvince.get(name);
    const top = cities
      ? [...cities].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, m]) => `${c}${m}`).join("/")
      : "—";
    console.log(`  ${name.padEnd(6, "　")} ${String(n).padStart(5)}   ${top}`);
  }

  const emptyProvinces = provincesWithoutStations(byProvince);
  if (emptyProvinces.length > 0) {
    console.log("");
    console.log(`没有电台的省级行政区（${emptyProvinces.length}）：${emptyProvinces.join("、")}`);
  }

  await writeFile(
    REPORT,
    JSON.stringify(
      {
        generatedAt: payload.generatedAt,
        total,
        placed,
        cityFilled,
        provinceOnly,
        byProvince: Object.fromEntries(byProvince),
        byProvinceCities: Object.fromEntries(
          [...citiesOfProvince].map(([prov, cities]) => [
            prov,
            Object.fromEntries([...cities].sort((a, b) => b[1] - a[1])),
          ]),
        ),
        bySource: Object.fromEntries(bySource),
        unresolved,
      },
      null,
      0,
    ),
  );

  console.log("");
  console.log(`文件 ${(body.length / 1024).toFixed(0)} KB → ${OUT}`);
  console.log(`未识别清单 ${unresolved.length} 条 → ${REPORT}`);
  if (unresolved.length > 0) {
    console.log("");
    console.log("未识别样例（补品牌词典时按这个顺序看）：");
    for (const u of unresolved.slice(0, 12)) {
      console.log(`  ${u.name.slice(0, 26).padEnd(28)} state=${u.state || "—"}`);
    }
  }
  console.log("");
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/** 找出一个电台都没有的省级行政区——多半是识别规则漏了，值得看一眼 */
function provincesWithoutStations(byProvince) {
  const names = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
    "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
    "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港",
    "澳门", "台湾",
  ];
  return names.filter((n) => !byProvince.has(n));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
