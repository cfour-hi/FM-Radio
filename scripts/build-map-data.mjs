#!/usr/bin/env node
/*
 * 生成地图点位快照。
 *
 * 为什么要有这一步：
 * radio-browser 没有「只返回带坐标的电台」这种查询参数（has_geo 会被忽略），
 * 而带坐标的台只占约四分之一。如果让浏览器直连接口去凑，为了拿到一两千个点
 * 要下载十几 MB JSON。所以把这一步挪到构建期：现在多花两分钟，用户少下十几 MB。
 *
 * 采样策略是「按国家均衡」而不是「按点击量取前 N」：
 * 后者会让欧美占满地图、非洲几乎空白。每个国家取自己点击量最高的一批带坐标电台，
 * 于是小国也能在图上有一个点。
 *
 * 最后一道工序是坐标清洗：众包库里有人把中国台标到大西洋、把奥地利台标到佛罗里达，
 * 这些点会孤零零挂在海面上，比没有点更难看。规则见 dropOutliers()。
 *
 * 用法：pnpm map:data
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferChinaGeo, loadCnGeo, resolveStation } from "./cn-geo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/map-stations.json");

/**
 * 走「中国」这条路的地区代码。
 *
 * 港澳台在这里和大陆一起处理：它们在地图上是中国的一小块，
 * 归属字段也要按省级行政区算（中国香港 / 中国澳门 / 中国台湾）。
 */
const CHINA_REGION = new Set(["CN", "HK", "MO", "TW"]);

const MIRRORS = [
  "de2.api.radio-browser.info",
  "fi1.api.radio-browser.info",
  "de1.api.radio-browser.info",
  "all.api.radio-browser.info",
];

const SCAN_LIMIT = 160;
const CONCURRENCY = 6;
/** 国家电台数低于这个值就不去扫了，扫了也基本没有坐标 */
const MIN_COUNTRY_STATIONS = 2;

/**
 * 每个国家留多少个点。
 * 小国给 14 个就已经能看清，大国的点会连成一片，多给一些才不显得城市之间空着。
 */
const quotaFor = (stationCount) => {
  if (stationCount >= 1200) return 48;
  if (stationCount >= 400) return 24;
  return 14;
};

/*
 * 中国的处理方式和其他国家完全不同，这几个常量只对它生效。
 *
 * 为什么要单开一条路：中国有 2400 多个台，带合法坐标的只有二三十个，
 * 按 quotaFor 的 48 个配额去扫「带坐标的台」，扫到底也只有二三十个能上图，
 * 剩下的被 geoOf() 判死。所以中国改走「全量拉取 + 从台名反推城市」的路径，
 * 配额也另算。
 *
 * 配额从 260 提到 420，是被「覆盖地级市」这个目标反推出来的：
 * 原来是每个城市保底 1 个、但第一轮只放 62% 的配额（161 个名额），
 * 剩下的按点击量补，于是地图上只铺开一百多个城市，多出来的省份是空的。
 * 要覆盖到 250 个以上地级市，配额本身就得大过那个数。
 * 420 散在两百多个城市里，每个城市一到两个点，密度仍低于欧洲（那有 700 个点）。
 */
const CN_MAX_PAGES = 40;
const CN_QUOTA = 420;

/**
 * 从可定位的中国台里挑出要上图的。
 *
 * 不能简单按点击量取前 N：众包库的点击量极度偏斜，头部几十个台
 * 全是央视和 CNR 的伴音流，照这个排法北京会占掉一大半配额，
 * 而广州、成都、西安这些真正有地方台的城市一个都上不去。
 *
 * 分三步：
 *   0. 有独立台呼的品牌台必须上图
 *   1. 每个城市保底 1 个代表，让地图铺开到大半个中国
 *   2. 剩下的配额按点击量补，但每个城市、每个省都有上限
 *
 * 第 0 步是这一轮补的，为的是「金鹰955」这类台：它的点击量是 1，排在两千名开外，
 * 任何按点击量截断的规则都会把它丢掉——可它恰恰是用户想在地图上找到的那种台。
 * 品牌词典里的台名总共二十几个，全进来对密度没有影响，
 * 但地图这才有了「地标」：能对上名字的台一定在图上的正确位置。
 *
 * 城市上限这一条是实测补的：铺开之后剩下的名额按纯点击量排序全被北京吸走，
 * 有一版北京一个城市就占了 49 个点。
 *
 * 省上限是这一轮加的：城市上限只管住单个城市，管不住「广东有二十个城市，
 * 于是广东一个省吃掉三分之一配额」。省上限按配额的三成算，
 * 大省能比小省多，但不至于把整张图变成一两个省的高亮图。
 */
const CN_CITY_CAP = 6;
/** 省上限。第一轮（每市保底）不受它约束——保底就是保底，不能被上限挤掉。 */
const CN_PROVINCE_CAP = Math.round(CN_QUOTA * 0.3);

/** 同一个城市的分组键。有真实坐标的台没有 place，用坐标取整当 key。 */
const cityKeyOf = (s) => s.place || `@${Math.round(s.lat)},${Math.round(s.lon)}`;

function pickChina(placed, quota) {
  const byCity = new Map();
  for (const s of placed) {
    const key = cityKeyOf(s);
    const list = byCity.get(key);
    if (list) list.push(s);
    else byCity.set(key, [s]);
  }
  for (const list of byCity.values()) list.sort((a, b) => b.clicks - a.clicks);

  // 城市按「最强的那一个台」排序，影响力大的城市先占位
  const cities = [...byCity.entries()].sort((a, b) => b[1][0].clicks - a[1][0].clicks);

  const out = [];
  const chosen = new Set();
  const takenPerCity = new Map();
  const takenPerProvince = new Map();
  const provinceOf = (s) => s.province || "?";

  const take = (s) => {
    if (chosen.has(s.id)) return false;
    out.push(s);
    chosen.add(s.id);
    takenPerCity.set(cityKeyOf(s), (takenPerCity.get(cityKeyOf(s)) ?? 0) + 1);
    takenPerProvince.set(provinceOf(s), (takenPerProvince.get(provinceOf(s)) ?? 0) + 1);
    return true;
  };

  // 0. 品牌台呼，无条件进——它们数量少，却是地图上能被叫出名字的地标
  for (const s of placed) {
    if (String(s.geoSource || "").startsWith("brand:")) take(s);
  }

  /*
   * 1. 每个城市保底 1 个。占七成配额，但不超过城市总数——
   * 城市比配额少时（现在就是这样，能定位的城市近三百个），宁可把这一轮走完，
   * 也不留缺口让第二轮重新灌进大城市。
   */
  const firstRound = Math.min(cities.length, Math.round(quota * 0.7));
  let cityCovered = 0;
  for (let i = 0; i < firstRound && out.length < quota; i++) {
    const list = cities[i][1];
    const pick = list.find((s) => !chosen.has(s.id));
    if (pick && take(pick)) cityCovered++;
  }

  // 2. 剩下的按点击量补
  const rest = cities.flatMap(([key, list]) => list.map((s) => ({ s, key })));
  rest.sort((a, b) => b.s.clicks - a.s.clicks);

  for (const { s, key } of rest) {
    if (out.length >= quota) break;
    if (chosen.has(s.id)) continue;
    const used = takenPerCity.get(key) ?? 0;
    if (used >= CN_CITY_CAP) continue;
    const provinceUsed = takenPerProvince.get(provinceOf(s)) ?? 0;
    if (used === 0 && provinceUsed >= CN_PROVINCE_CAP) continue;
    take(s);
  }

  return { chosen: out, cityCount: cityCovered, distinctCities: new Set(out.map(cityKeyOf)).size };
}

/**
 * 拉取并定位中国大陆的电台。
 *
 * 返回的每一条都有坐标：要么是接口给的（approx = 0），要么是从地名反推的（approx = 1）。
 * 反推不出来的一律丢弃——那些基本是「华语金曲 500 首」「雨声轻音乐」这类
 * 没有地理归属的网络台，硬塞一个坐标等于凭空捏造。
 */
async function collectChina() {
  const rows = [];
  /*
   * 翻到接口取空为止，不再写死一个上限。
   *
   * 原来写的是 offset < 1600，而中国实际有两千多个台——按点击量倒序拉，
   * 排在 1600 之后的长尾台（比如 clickcount=1 的「金鹰955」）根本没进过候选，
   * 后面所有推断都无从谈起。让它自然取空，代价只是多二三十次请求。
   *
   * 港澳台各拉一遍：它们在接口里是独立的国家代码，但在地图上属于中国。
   */
  for (const code of CHINA_REGION) {
    for (let page = 0; page < CN_MAX_PAGES; page++) {
      let batch;
      try {
        batch = await get("/json/stations/search", {
          countrycode: code,
          limit: 100,
          offset: page * 100,
          hidebroken: "true",
          order: "clickcount",
          reverse: "true",
        });
      } catch {
        break;
      }
      if (!Array.isArray(batch) || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < 100) break;
    }
  }

  const candidates = [];
  const seen = new Set();
  for (const raw of rows) {
    const station = pick(raw, { allowNoGeo: true });
    if (!station || seen.has(station.url)) continue;
    seen.add(station.url);
    candidates.push(station);
  }

  const { stats } = await inferChinaGeo(candidates);
  const placed = candidates.filter((s) => s.lat && s.lon);
  const { chosen, distinctCities } = pickChina(placed, CN_QUOTA);

  const unplaced = candidates.length - placed.length;
  const provinces = new Set(chosen.map((s) => s.province).filter(Boolean));
  const withProvince = candidates.filter((s) => s.province).length;
  console.log(
    `中国：拉到 ${candidates.length} 个台，有省级归属 ${withProvince} 个，定位 ${placed.length} 个` +
      `（真实坐标 ${stats.real}，反查坐标 ${stats.coord}，台名城市 ${stats.city}，` +
      `台名省份 ${stats.province}，国家级 ${stats.national}，品牌台呼 ${stats.brand}，` +
      `域名 ${stats.domain}），无地理线索 ${unplaced} 个；` +
      `坐标校验剔除 ${stats.rejected} 个；` +
      `入选 ${chosen.length} 个，覆盖 ${distinctCities} 个城市 / ${provinces.size} 个省级行政区`,
  );

  return chosen;
}

let mirror = MIRRORS[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}, attempt = 0) {
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

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * 与 src/lib/normalize.ts 保持同一套判据。
 * 改这里之前先看那边的注释：接口会用 0 表示「未填写」，而且经常只填一边。
 */
function geoOf(raw) {
  const lat = num(raw.geo_lat);
  const lon = num(raw.geo_long);
  if (lat === 0 || lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

function pick(raw, { allowNoGeo = false } = {}) {
  const url = text(raw.url_resolved) || text(raw.url);
  // 只收 https：和列表页一样，混合内容的台在地图上也放不了
  if (!url.startsWith("https://")) return null;
  const geo = geoOf(raw);
  /*
   * 其他国家没有坐标就直接跳过。中国例外：那边的台几乎都没坐标，
   * 但地名藏在台名里，交给 inferChinaGeo() 反推。allowNoGeo 就是为它开的。
   */
  if (!geo && !allowNoGeo) return null;
  const id = text(raw.stationuuid);
  if (!id) return null;
  return {
    id,
    name: text(raw.name) || "未命名电台",
    url,
    countryCode: text(raw.countrycode).toUpperCase(),
    countryName: text(raw.country),
    /*
     * 省 / 州。
     *
     * 这一列只给地图放大后的标签用：贴到城市级时没有底图、没有地名注记，
     * 视野里就几个孤零零的点，不加区域名根本不知道自己在哪。
     * 众包库里这一列填得并不齐（法国、意大利大面积空着），空就空着，
     * 前端按缺省处理，不要拿国家名去顶替——那会把巴黎的台全标成「France」。
     */
    state: text(raw.state),
    codec: (text(raw.codec) || "UNKNOWN").toUpperCase(),
    bitrate: num(raw.bitrate),
    clicks: num(raw.clickcount),
    hls: raw.hls === 1 || raw.hls === true,
    sslError: Boolean(text(raw.ssl_error)),
    lat: geo?.lat ?? null,
    lon: geo?.lon ?? null,
    /*
     * 主页只给归属解析用（域名线索：hnradio.com → 湖南）。
     * 快照里不存它——那是十几 KB 的纯负担，卡片也不显示主页。
     */
    homepage: text(raw.homepage),
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
 * 众包坐标里有一类错得很离谱：广东音乐之声被标到了大西洋（39°N 36°W），
 * 北京音乐广播的经度填成了 40（落在土耳其），还有把奥地利台标到佛罗里达的。
 * 它们会孤零零挂在海面上，比没有点更显眼。
 *
 * 判据是同国点位的「最近邻距离」：正常的台总有个邻居在几十公里内，
 * 标错大洲的则离最近的同国台也有几千公里。阈值取
 * max(15°, 该国中位数 × 8)——后者让俄罗斯、智利这种本来就横跨几十度的国家
 * 不会把自己的远东点删掉，前者保证大城市密集的国家不会因为中位数接近 0 而误伤周边。
 *
 * 已知代价：真正孤悬海外的台会被当成错误。夏威夷和哈巴罗夫斯克各有一个点会掉，
 * 这是为清掉十几个假点付的账。国家点位数少于 4 时没有足够样本，一律保留。
 */
function dropOutliers(stations) {
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

/**
 * 只重建中国部分。
 *
 * 全量跑一次要打一千六百多次请求、十分钟；而海外点位几乎不随时间变化，
 * 改的只是中国这边的推断规则和归属字段时，没必要把它们全部重下一遍。
 * 这个模式下沿用上次快照里的海外行，只重算 CN / HK / MO / TW。
 *
 * 代价是海外点位的时间戳会停在上一版——所以它是「改规则时的快速迭代工具」，
 * 不是发布流程。要出正式快照，还是跑全量。
 */
const CN_ONLY = process.argv.includes("--cn-only");

/** 读旧快照，把非中国（CN/HK/MO/TW 之外）的行还原成 station 对象 */
async function readExistingForeign() {
  const payload = JSON.parse(await readFile(OUT, "utf8"));
  const rows = Array.isArray(payload.stations) ? payload.stations : [];
  const out = [];
  for (const row of rows) {
    const countryCode = text(row[3]).toUpperCase();
    if (CHINA_REGION.has(countryCode)) continue;
    out.push({
      id: text(row[0]),
      name: text(row[1]),
      url: text(row[2]),
      countryCode,
      countryName: text(row[4]),
      codec: text(row[5]),
      bitrate: num(row[6]),
      lat: num(row[7]),
      lon: num(row[8]),
      clicks: num(row[9]),
      hls: num(row[10]) === 1,
      sslError: num(row[11]) === 1,
      state: text(row[12]),
      approx: num(row[13]),
      place: text(row[14]) || null,
      province: text(row[15]) || null,
      city: text(row[16]) || null,
    });
  }
  return out;
}

/**
 * 给港澳台的台补省份。
 *
 * 它们走的是「按国家采样」那条路，那条路只管坐标、不管归属。
 * 但它们在归属上是中国的省级行政区，不补的话中国大陆之外
 * 就没有任何省市信息，而这部分台在列表里照样要显示「中国香港」。
 */
async function fillChinaRegionProvinces(stations) {
  const geo = await loadCnGeo();
  let filled = 0;
  for (const station of stations) {
    if (station.province) continue;
    if (!CHINA_REGION.has(station.countryCode)) continue;
    const found = resolveStation(geo, station);
    if (!found?.province) continue;
    station.province = found.province.name;
    station.provinceCode = found.province.code;
    station.city = found.city ?? null;
    filled++;
  }
  return filled;
}

async function main() {
  const t0 = Date.now();
  console.log(`镜像 ${mirror}${CN_ONLY ? "（仅重建中国部分）" : ""}`);

  let countries = [];
  let picked = [];
  let dropped = [];
  let failed = 0;

  if (!CN_ONLY) {
    countries = (await get("/json/countries"))
      .map((row) => ({
        code: text(row.iso_3166_1).toUpperCase(),
        name: text(row.name),
        count: num(row.stationcount),
      }))
      /*
       * 中国走 collectChina() 那条独立路径，这里排掉，否则它会被当成
       * 「一个只有二十来个带坐标台的小国」采一遍，白跑一百多条请求。
       * 港澳台也交给中国那条路径，它们的归属要和大陆的台一起算。
       */
      .filter(
        (c) =>
          /^[A-Z]{2}$/.test(c.code) &&
          c.count >= MIN_COUNTRY_STATIONS &&
          !CHINA_REGION.has(c.code),
      );

    console.log(`国家/地区 ${countries.length} 个，开始按国家采样…`);
  } else {
    picked = await readExistingForeign();
    console.log(`沿用上次快照的海外点位 ${picked.length} 个，只重算中国部分`);
  }

  let done = 0;

  if (!CN_ONLY) {
    const perCountry = await mapLimit(countries, CONCURRENCY, async (country) => {
      let rows;
      try {
        rows = await get("/json/stations/search", {
          countrycode: country.code,
          limit: SCAN_LIMIT,
          hidebroken: "true",
          order: "clickcount",
          reverse: "true",
        });
      } catch {
        failed++;
        return [];
      }
      // 先把 160 条里所有合格的都收下，清洗完再按配额截断：
      // 若边挑边截，被剔掉一个错点就再也补不回来，只会留下空位。
      const candidates = [];
      const seen = new Set();
      for (const raw of Array.isArray(rows) ? rows : []) {
        const station = pick(raw);
        if (!station || seen.has(station.url)) continue;
        seen.add(station.url);
        candidates.push(station);
      }
      done++;
      if (done % 40 === 0) console.log(`  ${done}/${countries.length} …`);
      return candidates;
    });

    // 去重：同一个台偶尔会挂在两个国家名下
    const byId = new Map();
    const byUrl = new Set();
    for (const list of perCountry) {
      for (const station of list) {
        if (byUrl.has(station.url) || byId.has(station.id)) continue;
        byUrl.add(station.url);
        byId.set(station.id, station);
      }
    }

    const pool = [...byId.values()];
    const cleaned = dropOutliers(pool);
    dropped = cleaned.dropped;

    // 清洗之后再按国家配额截断；pool 已按国家的点击量顺序排列，先到先得
    const quotaOfCountry = new Map(countries.map((c) => [c.code, quotaFor(c.count)]));
    const takenPerCountry = new Map();
    for (const station of pool) {
      if (!cleaned.keep.has(station.id)) continue;
      const code = station.countryCode || "??";
      const quota = quotaOfCountry.get(code) ?? 14;
      const used = takenPerCountry.get(code) ?? 0;
      if (used >= quota) continue;
      takenPerCountry.set(code, used + 1);
      picked.push(station);
    }
  }

  /*
   * 中国（含港澳台）在配额和清洗之外单独走一遍。
   *
   * 不参与 dropOutliers：它的坐标本来就是按城市推算的，几百个台散在省会周边
   * 几十公里内，拿「离最近的同国点太远」去判它没有意义，反而可能误删。
   */
  const china = await collectChina();
  const stations = [...picked, ...china].sort((a, b) => b.clicks - a.clicks);

  // 港澳台走的是按国家采样那条路，那条路不管归属，这里统一补一次
  const fillCount = await fillChinaRegionProvinces(stations);
  if (fillCount > 0) console.log(`给港澳台补归属 ${fillCount} 个`);

  // 紧凑数组而不是对象：字段名重复两千次就是几十 KB
  const rows = stations.map((s) => [
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
    // 追加在末尾：老快照没有这一列，按 undefined 读出来是空串，不会错位
    // 中国台留空时用省份顶上——「湖南」比空字符串有用，标签层和筛选都能直接用
    s.state || s.province || "",
    // 同上。1 表示这个坐标是从台名里的地名推出来的，不是接口给的
    s.approx ?? 0,
    // 推算出的落点城市名，给卡片上「位置为估算」那行用
    s.place ?? "",
    /*
     * 归属。这两列是这一版新加的，只对中国（含港澳台）的台有值——
     * 其他国家的省/州在 state 里本来就是齐的，没必要再算一遍。
     */
    s.province ?? "",
    s.city ?? "",
    /*
     * 城市级还是只到省。0 = 城市，1 = 仅到省，2 = 没算出来。
     * 卡片要据此决定写「位置为估算 · 长沙」还是「位置仅到省 · 台湾」。
     */
    s.geoPrecision === "city" ? 0 : s.geoPrecision === "province" ? 1 : 2,
  ]);

  const payload = {
    v: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "radio-browser.info",
    fields: ["id", "name", "url", "cc", "country", "codec", "bitrate", "lat", "lon", "clicks", "hls", "sslError", "state", "approx", "place", "province", "city", "prec"],
    stations: rows,
  };

  await mkdir(dirname(OUT), { recursive: true });
  const body = JSON.stringify(payload);
  await writeFile(OUT, body);

  const perCode = new Map();
  for (const s of stations) perCode.set(s.countryCode, (perCode.get(s.countryCode) ?? 0) + 1);

  console.log("");
  console.log(`点位 ${stations.length} 个，覆盖 ${perCode.size} 个国家/地区`);
  console.log(`文件 ${(body.length / 1024).toFixed(0)} KB`);
  console.log(`失败国家 ${failed} 个，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  if (dropped.length > 0) {
    console.log("");
    console.log(`坐标清洗剔除 ${dropped.length} 个（离最近的同国点位太远）：`);
    for (const d of dropped) {
      console.log(
        `  ${d.code} ${d.station.name.slice(0, 28).padEnd(30)} @${d.station.lat},${d.station.lon}` +
          `  最近邻 ${d.gap.toFixed(0)}° > ${d.limit.toFixed(0)}°`,
      );
    }
  }

  const regionOf = (code) =>
    ({
      AD: "EU", AL: "EU", AT: "EU", AX: "EU", BA: "EU", BE: "EU", BG: "EU", BY: "EU", CH: "EU",
      CY: "EU", CZ: "EU", DE: "EU", DK: "EU", EE: "EU", ES: "EU", FI: "EU", FO: "EU", FR: "EU",
      GB: "EU", GG: "EU", GI: "EU", GR: "EU", HR: "EU", HU: "EU", IE: "EU", IM: "EU", IS: "EU",
      IT: "EU", JE: "EU", LI: "EU", LT: "EU", LU: "EU", LV: "EU", MC: "EU", MD: "EU", ME: "EU",
      MK: "EU", MT: "EU", NL: "EU", NO: "EU", PL: "EU", PT: "EU", RO: "EU", RS: "EU", RU: "EU",
      SE: "EU", SI: "EU", SJ: "EU", SK: "EU", SM: "EU", UA: "EU", VA: "EU", XK: "EU",
      US: "NA", CA: "NA", MX: "NA", BM: "NA", GL: "NA", PM: "NA",
      AR: "SA", BO: "SA", BR: "SA", CL: "SA", CO: "SA", EC: "SA", FK: "SA", GF: "SA", GY: "SA",
      PE: "SA", PY: "SA", SR: "SA", UY: "SA", VE: "SA",
      DZ: "AF", AO: "AF", BJ: "AF", BW: "AF", BF: "AF", BI: "AF", CM: "AF", CV: "AF", CF: "AF",
      TD: "AF", KM: "AF", CG: "AF", CD: "AF", CI: "AF", DJ: "AF", EG: "AF", GQ: "AF", ER: "AF",
      SZ: "AF", ET: "AF", GA: "AF", GM: "AF", GH: "AF", GN: "AF", GW: "AF", KE: "AF", LS: "AF",
      LR: "AF", LY: "AF", MG: "AF", MW: "AF", ML: "AF", MR: "AF", MU: "AF", MA: "AF", MZ: "AF",
      NA: "AF", NE: "AF", NG: "AF", RW: "AF", ST: "AF", SN: "AF", SC: "AF", SL: "AF", SO: "AF",
      ZA: "AF", SS: "AF", SD: "AF", TZ: "AF", TG: "AF", TN: "AF", UG: "AF", EH: "AF", ZM: "AF",
      ZW: "AF", RE: "AF", YT: "AF", SH: "AF",
      AU: "OC", NZ: "OC", FJ: "OC", PG: "OC", NC: "OC", PF: "OC", SB: "OC", VU: "OC", WS: "OC",
      TO: "OC", GU: "OC", KI: "OC", FM: "OC", MH: "OC", PW: "OC", TV: "OC", NR: "OC",
    })[code] ?? "AS";

  const region = new Map();
  for (const s of stations) {
    const r = regionOf(s.countryCode);
    region.set(r, (region.get(r) ?? 0) + 1);
  }
  console.log("");
  console.log("按大洲（粗算，只用于看盲区）：");
  for (const [code, label] of [["AF", "非洲"], ["AS", "亚洲"], ["EU", "欧洲"], ["NA", "北美洲"], ["SA", "南美洲"], ["OC", "大洋洲"]]) {
    console.log(`  ${label.padEnd(4, "　")} ${region.get(code) ?? 0}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
