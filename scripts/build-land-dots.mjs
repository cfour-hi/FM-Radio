/**
 * 生成「大陆粒子」点阵。
 *
 * 用途是用一层细密的点把陆地勾出来。它不承载任何地理信息——不画国界、
 * 不画省界、也不给海岸描边，陆地的形状全靠点的分布自己长出来。
 *
 * 两种采样方式，因为 2D 与 3D 需要的数据不同：
 *
 *   pnpm map:dots          墨卡托网格 → public/land-dots.json        （2D 平面地图）
 *   pnpm map:dots:globe    球面均匀   → public/land-dots-globe.json  （3D 球体）
 *
 * 为什么不能共用一套：
 *
 * - 平面地图按墨卡托显示，网格也必须建在墨卡托空间里。用球面均匀采样的话，
 *   球面上等距的点被投影纵向拉伸后不再等距，南美以南、澳洲以南会出现一圈圈
 *   同心弧，看上去像水波纹。
 * - 反过来，墨卡托网格投到球面上，高纬度的点会被挤在一起，两极糊成条纹。
 *
 * 所以采样的空间必须和显示的空间一致。这是两套数据唯一的区别。
 *
 * 数据源：Natural Earth 110m land（scripts/data/ne_110m_land.geojson）。
 */
import fs from "node:fs";
import path from "node:path";

const SPHERE = process.argv.includes("--sphere");

const SRC = path.join(import.meta.dirname, "data", "ne_110m_land.geojson");
const OUT = path.join(import.meta.dirname, "..", "public", SPHERE ? "land-dots-globe.json" : "land-dots.json");

/* ------------------------------------------------------------------ */
/* 平面地图用的网格                                                     */
/* ------------------------------------------------------------------ */

/*
 * 网格密度。这个值决定的是「点距」而不是「点数」：
 *
 * 地图容器约 1080 × 535，陆地占其中三成左右，所以 185 × 120 的网格
 * 落下来约 7 千个点，在陆地上的间距接近 5px——点径 2px 时刚好留出缝隙。
 * 再密一档（260 × 170）就只剩 3.5px 间距，陆地会连成一整块米色，颗粒感全无。
 */
const COLS = 185;
const ROWS = 120;

/**
 * 只铺到实际会看到的纬度。
 *
 * 墨卡托在 ±85° 附近拉伸得离谱，南极洲会吃掉大量采样点，
 * 而地图默认视野的下沿在 -60° 左右，那些点纯属浪费。
 */
const LAT_TOP = 82;
const LAT_BOTTOM = -62;

/* ------------------------------------------------------------------ */
/* 球体用的采样                                                         */
/* ------------------------------------------------------------------ */

/**
 * 球面候选点数。
 *
 * 球面上平均点距 = sqrt(4π / N) 弧度。42000 → 1.0° → 约 111 公里。
 * 地图容器高约 535px 时球体直径也差不多是这个数（半径 268px），
 * 屏幕点距约 4.7px，与平面版（4.9px）几乎一致——两套数据的颗粒感才对得上。
 */
const SAMPLES = 42000;

/* 抖动幅度，单位是平均点距。0 会露出采样花纹，太大又会糊掉海岸线。 */
const JITTER = 0.42;

/* ------------------------------------------------------------------ */
/* 共用：轮廓数据与点判定                                               */
/* ------------------------------------------------------------------ */

const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));

/** 把 GeoJSON 摊平成「外环 + 内环（洞）」的列表，并算好外环包围盒 */
const polygons = [];
for (const feature of raw.features) {
  const coords = feature.geometry.coordinates;
  const parts = feature.geometry.type === "Polygon" ? [coords] : coords;
  for (const rings of parts) {
    const outer = rings[0];
    let minX = 180;
    let maxX = -180;
    let minY = 90;
    let maxY = -90;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    polygons.push({ rings, box: [minX, minY, maxX, maxY] });
  }
}

/** 射线法判断点是否在环内 */
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 在外环内、且不在任何一个洞里，才算陆地 */
function onLand(x, y) {
  for (const poly of polygons) {
    const [minX, minY, maxX, maxY] = poly.box;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (!inRing(poly.rings[0], x, y)) continue;
    let inHole = false;
    for (let k = 1; k < poly.rings.length; k++) {
      if (inRing(poly.rings[k], x, y)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * 确定性伪随机。用 Math.random 会让每次构建产出不同文件，
 * 快照就没法进版本库、也没法比对 diff。
 */
function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** 量化到 0.01 度：约 1 公里，肉眼完全看不出，体积却能降一半 */
const pack = (lon, lat) => [Math.round(lon * 100), Math.round(lat * 100)];

/* ------------------------------------------------------------------ */

const flat = [];
let candidates = 0;

/** 墨卡托公式：纬度 → 0..1（0 在北极） */
function mercY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function invMercY(y) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

if (SPHERE) {
  /*
   * 斐波那契螺旋：每步转一个黄金角、极角按等面积分布，
   * 是球面上最均匀的确定式布点。再用切平面抖动打散螺旋本身的规律性——
   * 不抖的话，密排时能看出一圈圈斜向的纹路。
   */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const step = Math.sqrt((4 * Math.PI) / SAMPLES);

  for (let i = 0; i < SAMPLES; i++) {
    candidates++;
    const z = 1 - (2 * (i + 0.5)) / SAMPLES;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = i * GOLDEN;

    let x = Math.cos(theta) * ring;
    let y = Math.sin(theta) * ring;
    let zz = z;

    const lat0 = Math.asin(zz);
    const lon0 = Math.atan2(y, x);

    // 抖动落在半径为 JITTER 个点距的圆内，不是方形——方形会在四角留疤
    const rho = step * JITTER * Math.sqrt(rand(i * 2 + 1));
    const ang = rand(i * 2 + 2) * Math.PI * 2;
    const dn = Math.sin(ang) * rho; // 向北
    const de = Math.cos(ang) * rho; // 向东

    const sp = Math.sin(lat0);
    const cp = Math.cos(lat0);
    const sl = Math.sin(lon0);
    const cl = Math.cos(lon0);
    // 东向、北向的单位切向量
    x += de * -sl + dn * -sp * cl;
    y += de * cl + dn * -sp * sl;
    zz += de * 0 + dn * cp;

    const len = Math.hypot(x, y, zz);
    x /= len;
    y /= len;
    zz /= len;

    const lat = (Math.asin(zz) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;

    // 抖动之后再判定：先判定再抖动的话，沿海的点会飘进海里
    if (!onLand(lon, lat)) continue;
    flat.push(...pack(lon, lat));
  }
} else {
  const yTop = mercY(LAT_TOP);
  const yBottom = mercY(LAT_BOTTOM);

  for (let row = 0; row < ROWS; row++) {
    const y = yTop + ((row + 0.5) / ROWS) * (yBottom - yTop);
    for (let col = 0; col < COLS; col++) {
      candidates++;
      const lon = -180 + ((col + 0.5) / COLS) * 360;

      // 在每个格子里挪一点，幅度控制在一格之内，不跨格
      const seed = row * COLS + col;
      const jx = (rand(seed + 1.7) - 0.5) * JITTER;
      const jy = (rand(seed + 9.1) - 0.5) * JITTER;
      const jLon = lon + (jx * 360) / COLS;
      const jLat = invMercY(y + (jy * (yBottom - yTop)) / ROWS);

      if (!onLand(jLon, jLat)) continue;
      flat.push(...pack(jLon, jLat));
    }
  }
}

const body = JSON.stringify({ v: 1, n: flat.length / 2, pts: flat });
fs.writeFileSync(OUT, body);

const gz = (await import("node:zlib")).gzipSync(Buffer.from(body)).length;

console.log(`${SPHERE ? "球面" : "墨卡托"}采样：候选点 ${candidates} → 陆地粒子 ${flat.length / 2} 个`);
console.log(`文件 ${(body.length / 1024).toFixed(0)} KB，gzip ${(gz / 1024).toFixed(0)} KB`);
console.log(`输出 ${path.relative(process.cwd(), OUT)}`);
