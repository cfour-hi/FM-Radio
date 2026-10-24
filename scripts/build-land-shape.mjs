#!/usr/bin/env node
/*
 * 生成陆地面。
 *
 * 这张地图上唯一的「地理信息」就是陆地本身：没有国界、没有省界、没有海岸描边，
 * 只有一块比海洋略亮的色块，用来把球体和平面上的大陆托出来。粒子负责质感，
 * 这一层负责体积——纯黑背景上撒一层点，球会散成漂浮的点云，立不起来。
 *
 * 数据取 Natural Earth 1:110m land。选它有两个原因：
 *   1. 它本身就是「陆地多边形」，属性里只有 featurecla=Land，
 *      不带任何行政区划——不存在需要关掉的省界，因为它从来就没有。
 *   2. 110m 是给全球视角用的精度，一百多 KB，放大到地区级海岸线会变粗块，
 *      但这也是刻意的取舍：这张图不做城市级底图，放大后靠电台点定位。
 *
 * 坐标压到 3 位小数（约 110 米）。原始数据保留 6 位，多出来的精度对 110m
 * 的几何毫无意义，只是让文件大一圈——重复的高位数字 gzip 压得掉，
 * 但解析和内存里都是实打实的开销。
 *
 * 用法：pnpm map:land
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "data/ne_110m_land.geojson");
const OUT = resolve(HERE, "../public/land.json");

const DECIMALS = 3;
const SCALE = 10 ** DECIMALS;

/**
 * 化简一个环：四舍五入 + 去掉因为取整而重合的相邻点。
 *
 * 取整会让相距不到 110 米的两个点变成同一个坐标，连成一串重复点时
 * 三角化要处理零面积三角形，渲染出来是碎裂纹路。
 */
function simplifyRing(ring) {
  const out = [];
  let prevX = Number.NaN;
  let prevY = Number.NaN;
  for (const position of ring) {
    const x = Math.round(position[0] * SCALE) / SCALE;
    const y = Math.round(position[1] * SCALE) / SCALE;
    if (x === prevX && y === prevY) continue;
    out.push([x, y]);
    prevX = x;
    prevY = y;
  }
  // 闭合环至少要 3 个不同顶点 + 回到起点
  return out.length >= 4 ? out : null;
}

/** 一个多边形里，外环没了就整个丢掉；内环（湖泊）丢了只是少个洞 */
function simplifyPolygon(rings) {
  const [outer, ...holes] = rings;
  const keptOuter = outer ? simplifyRing(outer) : null;
  if (!keptOuter) return null;
  const keptHoles = [];
  for (const hole of holes) {
    const kept = simplifyRing(hole);
    if (kept) keptHoles.push(kept);
  }
  return [keptOuter, ...keptHoles];
}

function simplifyGeometry(geometry) {
  if (geometry.type === "Polygon") {
    const polygon = simplifyPolygon(geometry.coordinates);
    return polygon ? { type: "Polygon", coordinates: polygon } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = [];
    for (const rings of geometry.coordinates) {
      const polygon = simplifyPolygon(rings);
      if (polygon) polygons.push(polygon);
    }
    return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
  }
  return null;
}

const source = JSON.parse(await readFile(SRC, "utf8"));
const features = [];
let dropped = 0;

for (const feature of source.features ?? []) {
  const geometry = simplifyGeometry(feature.geometry);
  if (!geometry) {
    dropped++;
    continue;
  }
  // properties 里除了 featurecla 什么都没有，留着只是重复
  features.push({ type: "Feature", properties: {}, geometry });
}

const payload = {
  v: 1,
  source: "Natural Earth 1:110m land (public domain)",
  features,
};

const body = JSON.stringify(payload);
await writeFile(OUT, body);

const countPoints = (geometry) => {
  const rings =
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  return rings.reduce((sum, ring) => sum + ring.length, 0);
};
const points = features.reduce((sum, f) => sum + countPoints(f.geometry), 0);

console.log(`陆地多边形 ${features.length} 个${dropped > 0 ? `（丢弃退化 ${dropped}）` : ""}`);
console.log(`顶点 ${points} 个，精度 ${DECIMALS} 位小数`);
console.log(`输出 ${OUT.replace(resolve(HERE, "..") + "/", "")}，${(body.length / 1024).toFixed(0)} KB`);
