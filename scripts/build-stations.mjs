#!/usr/bin/env node
/*
 * 生成地图分片数据：core（首屏）/ rest（闲时）/ catalog（搜索懒加载）。
 *
 * 与早期「按国家均衡采样」的方案相比：
 *   早期只留两千多台、中国按配额截断；这个脚本拉全量、筛出所有
 *   https 可播台，然后按「有没有坐标」分类：
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
 *   2. pnpm data:check          抽查热门流是否还能连上
 *   3. 看脚本打印的汇总数字是否正常（台数 / 各片体积 / 中国推断点数），再发布 dist
 *
 * 构建失败或快照校验不过时不会写入任何文件；确认数据确实变少时用
 * `--force` 跳过缩水检查。数据每天才新一次对收音机完全够——死流是周级别
 * 的事，不需要更勤。
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferChinaGeo } from "./cn-geo.mjs";
import { CAPITALS } from "./cn-admin.mjs";
import { get, pick, dropOutliers } from "./lib/radio.mjs";
import { checkShrink, validateSnapshot } from "./lib/snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../src/data");

/** 中国（含港澳台）单走推断路径，不在境外采样里。 */
const CHINA_REGION = new Set(["CN", "HK", "MO", "TW"]);

/** 全量翻页：每页 1000，最多 100 页（> 总台数 6.3 万，够用）。 */
const PAGE = 1000;
const MAX_PAGES = 100;

/**
 * core 里境外台的条数上限（中国台全部进 core，不占这个额度）。
 *
 * core 是首屏阻塞下载的那一片，rest 会在地图就绪后补上——两者最终都画在
 * 地图上，所以这里只决定「第一帧先看到多少颗光点」。1000 条足够填满默认
 * 视角里境外最亮的那一圈，同时把首屏数据从约 400KB gzip 压到 200KB 左右。
 */
const CORE_FOREIGN = 1000;

/** 全量拉取的下限。低于这个数说明接口或分页出了问题，不能当成正常快照。 */
const MIN_TOTAL = 10_000;

/** 维护者确认数据确实变少时用 --force 跳过「不能缩水」的检查。 */
const FORCE = process.argv.includes("--force");

/** 三份分片的文件名，读写共用，避免字符串抄两遍。 */
const SHARDS = {
  core: "stations-core.json",
  rest: "stations-rest.json",
  catalog: "stations-catalog.json",
};

const round3 = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1e3) / 1e3 : value;

/* 前 18 列保持兼容，追加语言与类型原始元数据。 */
const FIELDS = [
  "id", "name", "url", "cc", "country", "codec", "bitrate", "lat", "lon",
  "clicks", "hls", "sslError", "state", "approx", "place", "province", "city", "prec", "languages", "tags",
];

const toRow = (s) => [
  s.id,
  s.name,
  s.url,
  s.countryCode,
  s.countryName,
  s.codec,
  s.bitrate,
  // 3 位小数≈100 米，对电台定位足够；4 位只是白占体积（一万多个点合起来不可忽略）
  round3(s.lat),
  round3(s.lon),
  s.clicks,
  s.hls ? 1 : 0,
  s.sslError ? 1 : 0,
  s.state || s.province || "",
  s.approx ?? 0,
  s.place ?? "",
  s.province ?? "",
  s.city ?? "",
  s.geoPrecision === "city" ? 0 : s.geoPrecision === "province" ? 1 : 2,
  s.languages || "",
  s.tags || "",
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
      /*
       * 不能 break：翻到一半停下，产物仍然「有效」，只是少了后半截。
       * 这种残缺快照发出去比构建失败难查得多——构建失败立刻看得见。
       */
      throw new Error(`第 ${page + 1} 页拉取失败：${err.message}`);
    }
    if (!Array.isArray(rows)) throw new Error(`第 ${page + 1} 页返回的不是数组`);
    if (rows.length === 0) break;
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

/** 读上一版的三片数量；文件不存在（首次生成）时返回 0，不触发缩水检查。 */
async function readPreviousCounts() {
  const counts = {};
  for (const [key, file] of Object.entries(SHARDS)) {
    counts[key] = await readFile(resolve(OUT_DIR, file), "utf8")
      .then((raw) => {
        const snapshot = JSON.parse(raw);
        return Array.isArray(snapshot.stations) ? snapshot.stations.length : 0;
      })
      .catch(() => 0);
  }
  return counts;
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
  // 本地 --input 常用于调试小样本，不对它设全量下限；在线拉取则必须够量
  if (!inputArg && all.length < MIN_TOTAL) {
    throw new Error(`只拉到 ${all.length} 台，低于下限 ${MIN_TOTAL}，拒绝生成快照`);
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

  /*
   * 写盘前的最后一道闸：任何一条不过，三份文件一个都不写。
   * 半份新数据混着半份旧数据，比完全没有新数据更难排查。
   */
  const previous = await readPreviousCounts();
  const counts = { core: core.length, rest: rest.length, catalog: catalog.length };
  const validation = validateSnapshot({ core, rest, catalog });
  const shrink = FORCE ? { ok: true, errors: [] } : checkShrink(previous, counts);
  const errors = [...validation.errors, ...shrink.errors];
  if (errors.length > 0) {
    console.error("快照校验失败，未写入任何文件：");
    for (const error of errors.slice(0, 20)) console.error(`  - ${error}`);
    if (errors.length > 20) console.error(`  …另有 ${errors.length - 20} 条`);
    process.exit(1);
  }

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
    fields: ["id", "name", "cc", "clicks", "url", "languages", "tags"],
    stations: catalog.map((s) => [s.id, s.name, s.countryCode, s.clicks, s.url, s.languages || "", s.tags || ""]),
  });

  await writeFile(resolve(OUT_DIR, SHARDS.core), coreBody);
  await writeFile(resolve(OUT_DIR, SHARDS.rest), restBody);
  await writeFile(resolve(OUT_DIR, SHARDS.catalog), catalogBody);

  const kb = (b) => `${(b.length / 1024).toFixed(0)} KB`;
  console.log("");
  console.log(`拉取全量 · 可用（https 可播） ${all.length}`);
  console.log(`可上图 ${core.length + rest.length}（中国 ${chinaPlaced.length} + 境外 ${foreignKeep.length}）`);
  if (previous.core || previous.rest || previous.catalog) {
    console.log(`上一版 core ${previous.core} · rest ${previous.rest} · catalog ${previous.catalog}`);
  }
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
