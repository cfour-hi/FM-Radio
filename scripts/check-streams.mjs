#!/usr/bin/env node
/*
 * 抽查快照里最热门的流还能不能连上。
 *
 * radio-browser 的 hidebroken 只反映上次巡检结果，不保证今天还活着。
 * 周更之后跑一遍：成片失效的国家或地区会在这里先露出来，而不是等用户
 * 点进去等八秒超时。
 *
 * 用法：
 *   pnpm data:check                 抽查点击量前 100
 *   pnpm data:check --limit=300     抽查前 300
 *   pnpm data:check --max-fail=0.4  失败率超过 40% 才返回非零
 *
 * 只发 GET + Range: bytes=0-0，连上就断开，不把音频读回来。部分流会拒绝
 * 非浏览器 UA 或返回 403，这种失败需要人工看一眼再判断。
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapLimit } from "./lib/radio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../src/data");

const SHARDS = ["stations-core.json", "stations-rest.json", "stations-catalog.json"];

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, value = ""] = arg.slice(2).split("=");
      return [key, value];
    }),
);

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const limit = Math.floor(toNumber(args.get("limit"), 100));
const timeout = toNumber(args.get("timeout"), 8000);
const maxFail = Math.min(1, toNumber(args.get("max-fail"), 0.3));

/** 三份分片的列序由各自的 fields 决定，按名字取，别按位置猜。 */
function stationFromRow(fields, row) {
  const at = (name) => {
    const index = fields.indexOf(name);
    return index >= 0 ? row[index] : undefined;
  };
  return {
    id: String(at("id") ?? ""),
    name: String(at("name") ?? "未命名电台"),
    url: String(at("url") ?? ""),
    clicks: Number(at("clicks")) || 0,
  };
}

async function loadStations() {
  const byId = new Map();
  for (const file of SHARDS) {
    const raw = await readFile(resolve(DATA_DIR, file), "utf8");
    const snapshot = JSON.parse(raw);
    const fields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
    for (const row of snapshot.stations ?? []) {
      const station = stationFromRow(fields, row);
      if (!station.id || !station.url || byId.has(station.id)) continue;
      byId.set(station.id, station);
    }
  }
  return [...byId.values()];
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-0", "User-Agent": "FM-Radio-StreamCheck/1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
    // 只确认「能连上、不是错误页」，剩下的字节不要
    await res.body?.cancel().catch(() => {});
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    const reason = controller.signal.aborted
      ? `超时（${timeout}ms）`
      : err instanceof Error
        ? err.message
        : "网络错误";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

const stations = await loadStations();
if (stations.length === 0) {
  console.error("没有读到任何电台，先跑 pnpm data:release 生成快照");
  process.exit(1);
}

stations.sort((a, b) => b.clicks - a.clicks);
const sample = stations.slice(0, limit);
console.log(`抽查点击量前 ${sample.length} 个流（目录共 ${stations.length} 个台）…`);

const results = await mapLimit(sample, 8, async (station) => ({
  station,
  ...(await probe(station.url)),
}));

const failed = results.filter((item) => !item.ok);
for (const item of failed.slice(0, 50)) {
  console.log(`✗ ${item.station.name} · ${item.reason}\n  ${item.station.url}`);
}
if (failed.length > 50) console.log(`…另有 ${failed.length - 50} 个失败未列出`);

const ratio = failed.length / Math.max(1, sample.length);
console.log(
  `\n成功 ${sample.length - failed.length} · 失败 ${failed.length}（${(ratio * 100).toFixed(1)}%）`,
);

if (ratio > maxFail) {
  console.error(`失败率高于 ${Math.round(maxFail * 100)}%，确认是网络问题还是这批台已经停播`);
  process.exit(1);
}
