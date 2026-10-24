#!/usr/bin/env node
/*
 * 生成地图分片数据：core（首屏）/ rest（闲时）/ catalog（搜索懒加载）。
 *
 * 与老的 build-map-data.mjs 的区别：
 *   老脚本按「国家均衡采样」只留 2148 台，中国按 420 配额截断。
 *   这个脚本拉 radio-browser 全量、筛出所有 https 可播台，然后按
 *   「有没有坐标」分类：
 *     - 有坐标   → 上图（中国全上 + 境外按点击量分 core / rest）
 *     - 无坐标   → 只进 catalog，能播但地图上定位不了
 *   中国台的坐标仍走 cn-geo.mjs 的 inferChinaGeo()（台名推断 + 确定性抖动），
 *   不再截断——凡是能推断出省市的台全部上图，推断不出的进 catalog。
 *
 * 产物三片写进 src/data/，前端用 Vite 的 `?url` 导入拿到带内容哈希的文件名，
 * 配合 CDN 强缓存实现「每周重发布一次、用户 0 重复下载」。
 *
 * 用法（周更流程，三步固定）：
 *   1. pnpm data:release        拉全量 + 重新构建（hash 文件名自动换新）
 *   2. 看脚本打印的汇总数字是否正常（台数 / 各片体积 / 中国推断点数）
 *   3. WorkBuddy 发布 dist
 * 数据每天才新一次对收音机完全够——死流是周级别的事，不需要更勤。
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferChinaGeo } from "./cn-geo.mjs";
import { CAPITALS } from "./cn-admin.mjs";
import { get, pick, dropOutliers } from "./lib/radio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../src/data");

/** 中国（含港澳台）单走推断路径，不在境外采样里。 */
const CHINA_REGION = new Set(["CN", "HK", "MO", "TW"]);

/** 全量翻页：每页 1000，最多 100 页（> 总台数 6.3 万，够用）。 */
const PAGE = 1000;
const MAX_PAGES = 100;

/** core 里境外台的条数上限（中国台全部进 core，不占这个额度）。 */
const CORE_FOREIGN = 3000;

/* 18 列，与老 map-stations.json 的 fields 完全一致，前端 decode 可复用 */
const FIELDS = [
  "id", "name", "url", "cc", "country", "codec", "bitrate", "lat", "lon",
  "clicks", "hls", "sslError", "state", "approx", "place", "province", "city", "prec",
];

const toRow = (s) => [
  s.id,
  s.name,
  s.url,
  s.countryCode,
  s.countryName,
  s.codec,
  s.bitrate,
  s.lat,
  s.lon,
  s.clicks,
  s.hls ? 1 : 0,
  s.sslError ? 1 : 0,
  s.state || s.province || "",
  s.approx ?? 0,
  s.place ?? "",
  s.province ?? "",
  s.city ?? "",
  s.geoPrecision === "city" ? 0 : s.geoPrecision === "province" ? 1 : 2,
];

/** 不带 countrycode，按点击量倒序翻页拉全量。 */
async function collectAll() {
  const out = [];
  const seenUrl = new Set();
  const seenId = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    let rows;
    try {
      rows = await get("/json/stations/search", {
        limit: PAGE,
        offset: page * PAGE,
        hidebroken: "true",
        order: "clickcount",
        reverse: "true",
      });
    } catch (err) {
      console.warn(`  第 ${page + 1} 页失败：${err.message}，停止翻页`);
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const raw of rows) {
      const s = pick(raw, { allowNoGeo: true });
      if (!s) continue;
      // 同一流被重复收录（duplicate）时只留先到的（点击量更高的）那一条
      if (seenUrl.has(s.url) || seenId.has(s.id)) continue;
      seenUrl.add(s.url);
      seenId.add(s.id);
      out.push(s);
    }
    if (rows.length < PAGE) break;
    if (page % 5 === 4) console.log(`  已拉 ${out.length} 台（第 ${page + 1} 页）…`);
  }
  return out;
}

/** 从本地已拉好的原始 JSON 读入并归一化，跳过在线拉取。供调试/重跑分类用。 */
function fromLocal(list) {
  const seenUrl = new Set();
  const seenId = new Set();
  const out = [];
  for (const item of list) {
    const s = pick(item, { allowNoGeo: true });
    if (!s) continue;
    if (seenUrl.has(s.url) || seenId.has(s.id)) continue;
    seenUrl.add(s.url);
    seenId.add(s.id);
    out.push(s);
  }
  return out;
}

async function main() {
  const t0 = Date.now();

  const inputArg = process.argv.find((a) => a.startsWith("--input="));
  let all;
  if (inputArg) {
    const raw = JSON.parse(await readFile(inputArg.slice(8), "utf8"));
    const list = Array.isArray(raw) ? raw : raw.stations;
    all = fromLocal(list);
    console.log(`从本地 ${list.length} 条读入 ${all.length} 台`);
  } else {
    console.log("拉取 radio-browser 全量…");
    all = await collectAll();
  }
  const chinaRaw = all.filter((s) => CHINA_REGION.has(s.countryCode));
  const foreignRaw = all.filter((s) => !CHINA_REGION.has(s.countryCode));
  console.log(`合计 ${all.length} 台（中国 ${chinaRaw.length} + 境外 ${foreignRaw.length}）`);

  /* 中国：台名推断坐标，不截断 */
  const { stats, geo } = await inferChinaGeo(chinaRaw);
  const chinaPlaced = chinaRaw.filter((s) => s.lat && s.lon).sort((a, b) => b.clicks - a.clicks);
  const chinaUnplaced = chinaRaw.filter((s) => !s.lat || !s.lon).sort((a, b) => b.clicks - a.clicks);
  console.log(
    `中国：推断定位 ${chinaPlaced.length} 个，无归属 ${chinaUnplaced.length} 个` +
      `（真实 ${stats.real}，反查 ${stats.coord}，城市 ${stats.city}，省 ${stats.province}，` +
      `国家 ${stats.country}，品牌 ${stats.brand}，域名 ${stats.domain}，无 ${stats.none}）`,
  );

  /* 境外：只对「有坐标」的台做离群点清洗，无坐标的直接进 catalog */
  const foreignPlaced = foreignRaw
    .filter((s) => s.lat && s.lon)
    .sort((a, b) => b.clicks - a.clicks);
  const foreignUnplaced = foreignRaw
    .filter((s) => !s.lat || !s.lon)
    .sort((a, b) => b.clicks - a.clicks);
  const cleaned = dropOutliers(foreignPlaced);
  const foreignKeep = foreignPlaced.filter((s) => cleaned.keep.has(s.id));
  console.log(
    `境外：有坐标 ${foreignPlaced.length} 个（清洗剔除 ${cleaned.dropped.length} 个），` +
      `无坐标 ${foreignUnplaced.length} 个`,
  );

  /* core = 中国全部 + 境外点击量前 CORE_FOREIGN；rest = 其余境外有坐标 */
  const core = [...chinaPlaced, ...foreignKeep.slice(0, CORE_FOREIGN)]
    .sort((a, b) => b.clicks - a.clicks);
  const rest = foreignKeep.slice(CORE_FOREIGN).sort((a, b) => b.clicks - a.clicks);
  const catalog = [...foreignUnplaced, ...chinaUnplaced].sort((a, b) => b.clicks - a.clicks);

  /*
   * meta：IP 定位后的「附近」tab 与城市英文名翻译要用。
   *   capitals  省 → 省会（行政事实，写死，供「优先展示省会的台」）
   *   cityAlias 英文城市名 → [中文名, 省]，只收上了图的中国城市
   */
  const knownCities = new Set(core.map((s) => s.city).filter(Boolean));
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

  const generatedAt = new Date().toISOString().slice(0, 10);
  const base = { v: 1, generatedAt, source: "radio-browser.info" };

  await mkdir(OUT_DIR, { recursive: true });

  const coreBody = JSON.stringify({
    ...base,
    fields: FIELDS,
    meta: { capitals: CAPITALS, cityAlias },
    stations: core.map(toRow),
  });
  const restBody = JSON.stringify({
    ...base,
    fields: FIELDS,
    stations: rest.map(toRow),
  });
  const catalogBody = JSON.stringify({
    ...base,
    fields: ["id", "name", "cc", "clicks", "url"],
    stations: catalog.map((s) => [s.id, s.name, s.countryCode, s.clicks, s.url]),
  });

  await writeFile(resolve(OUT_DIR, "stations-core.json"), coreBody);
  await writeFile(resolve(OUT_DIR, "stations-rest.json"), restBody);
  await writeFile(resolve(OUT_DIR, "stations-catalog.json"), catalogBody);

  const kb = (b) => `${(b.length / 1024).toFixed(0)} KB`;
  console.log("");
  console.log("拉取 62,790 · 可用（https 可播）" + `${all.length}`.padStart(8));
  console.log(`可上图 ${core.length + rest.length}（中国 ${chinaPlaced.length} + 境外 ${foreignKeep.length}）`);
  console.log(
    `core ${String(core.length).padStart(6)} 台  ${kb(coreBody).padStart(8)}` +
      ` · rest ${String(rest.length).padStart(6)} 台  ${kb(restBody).padStart(8)}` +
      ` · catalog ${String(catalog.length).padStart(6)} 台  ${kb(catalogBody).padStart(8)}`,
  );
  console.log(`中国推断点 ${chinaPlaced.filter((s) => s.approx).length} 个`);
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
