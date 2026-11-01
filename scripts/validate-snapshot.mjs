#!/usr/bin/env node
/*
 * 校验仓库里已提交的三份快照，不访问网络。
 *
 * build-stations.mjs 在写盘前会跑同一套校验；这个脚本用于 CI 和发布前
 * 复查：万一有人手动改过数据、或者合并冲突把某一片搞坏了，这里能拦住。
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot } from "./lib/snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../src/data");

const FILES = {
  core: "stations-core.json",
  rest: "stations-rest.json",
  catalog: "stations-catalog.json",
};

/** 快照是列式存储；按 fields 里的名字取，别按位置猜。 */
function toStation(fields, row) {
  const at = (name) => {
    const index = fields.indexOf(name);
    return index >= 0 ? row[index] : undefined;
  };
  return {
    id: at("id"),
    name: at("name"),
    url: at("url"),
    lat: at("lat") ?? null,
    lon: at("lon") ?? null,
  };
}

const errors = [];
const snapshot = {};

for (const [key, file] of Object.entries(FILES)) {
  let data;
  try {
    data = JSON.parse(await readFile(resolve(DATA_DIR, file), "utf8"));
  } catch (err) {
    errors.push(`${file} 读取失败：${err.message}`);
    continue;
  }
  if (!Array.isArray(data.fields)) errors.push(`${file} 缺少 fields`);
  if (typeof data.generatedAt !== "string") errors.push(`${file} 缺少 generatedAt`);
  snapshot[key] = (data.stations ?? []).map((row) => toStation(data.fields ?? [], row));
}

if (errors.length === 0) {
  errors.push(...validateSnapshot(snapshot).errors);
}

if (errors.length > 0) {
  console.error("快照校验失败：");
  for (const error of errors.slice(0, 20)) console.error(`  - ${error}`);
  if (errors.length > 20) console.error(`  …另有 ${errors.length - 20} 条`);
  process.exit(1);
}

console.log(
  `快照校验通过：core ${snapshot.core.length} · rest ${snapshot.rest.length} · catalog ${snapshot.catalog.length}`,
);
