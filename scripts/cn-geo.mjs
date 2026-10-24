/*
 * 中国电台的归属解析与坐标推断。
 *
 * 问题有两层，以前只解决了第一层：
 *
 *   1) 位置：radio-browser 里中国有 2400 多个台，带合法经纬度的只有二三十个。
 *      如果只画真实坐标，中国在图上基本是空的。
 *   2) 归属：这个台属于哪个省、哪座城市？这一层以前完全没做——
 *      能算出「大概在长沙」，却产不出「属于湖南」这条事实，
 *      于是列表页没法显示、筛选器没法筛、地图卡片也无从说明。
 *
 * 地名信息其实很密，只是藏在几个地方，按可信度从高到低排：
 *   - 台名里的城市：「佛山电台」「Guangzhou Traffic Radio」
 *   - 台名里的省名：「陕西交通广播」「云南音乐广播」
 *   - state 字段：名义上是省，实际什么都填——省名（Guangdong）、Wade-Giles
 *     （Kwangtung）、三字母缩写（hun）、中文（安徽）、也有直接填城市名的（Dalian）
 *   - 品牌台呼：「金鹰955」「动感101」——名字里一个地名都没有，
 *     只有靠 scripts/data/cn-brands.json 这份人工词典
 *   - 主页域名：「hnradio.com」→ 湖南
 *   - 真实坐标：有了坐标就能反查最近的居民点，拿到它所在的省
 *
 * 认出来的坐标都不是真实坐标，是「这个台大概在哪座城市」。所以：
 *   - 分配时在同城内做确定性抖动，避免几十个台叠成一个点
 *   - 结果带 approx 标记与 confidence，前端会据此说明位置是推断的
 *
 * 抖动必须是确定性的：同一条电台每次构建、每次刷新都得落在原位，
 * 否则用户关掉卡片再打开，点已经跑到别处去了。所以用 station.id 做哈希种子，
 * 而不是 Math.random()。
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPITALS, DOMAIN_HINTS, PROVINCES, PROVINCE_BY_COUNTRY } from "./cn-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLACES = resolve(HERE, "data/cn-places.json");
const BRANDS = resolve(HERE, "data/cn-brands.json");

/*
 * 国家级台：总部都在北京。
 *
 * 这份名单必须优先于一切其他线索。库里有「CNR-1 中国之声」这条，
 * state 字段填的是 Jiangsu（数据本身就是错的），先看 state 就会把
 * 中国之声判到江苏去。
 *
 * 名单里刻意不收「音乐之声」「经济之声」「文艺之声」这类栏目名：
 * 地方台大量重名，实测「怀集音乐之声」会被判到北京去。
 * 这类频率靠 CNR / 中央人民广播电台 这些前缀就够识别了。
 */
const NATIONAL = [
  "cctv", "cntv", "cgtn", "cnr", "cri", "crionline", "china plus",
  "中央人民广播电台", "中央广播电视总台", "中国之声", "中华之声", "神州之声",
  "环球资讯", "中国国际广播", "央广", "央视", "中央电视台",
];

/*
 * 中文匹配用。两字地名必须在台名靠前的位置出现，
 * 否则「东方」会配到海南东方市、「和平」会配到一堆乡镇。
 * 三个字以上基本不会有歧义，直接匹配。
 */
const ZH_MIN_LEN = 2;
const ZH_SHORT_HEAD = 6;

/**
 * 两字地名的人口门槛。
 *
 * GeoNames 里大量县级点位 population 是 0（数据缺失），而且重名极多：
 * 「凤凰」在山西宁武和河北宁晋各有一个，人口都记成 0——
 * 结果「凤凰卫视资讯台」被配到了山西宁武。
 *
 * 两字词歧义太大，只保留人口确实够多的城市；三字以上不受此限。
 */
const ZH_SHORT_MIN_POP = 50000;

/**
 * 两字通用词黑名单。
 *
 * 这些词本身是地名，但在台名里更常作普通词用：
 * 「东方音乐」「阳光电台」「和平之声」。它们对应的城市丢掉不影响什么，
 * 而误匹配会让一堆台飞到不相干的地方。
 *
 * 「中心」「新城」「城区」是富化跑完才发现的：云南有个点就叫「中心」，
 * 人口够大、两字、出现在台名开头，于是「新闻中心」这类名字全被算成了
 * 云南某地。这类词必须挡在匹配之前。
 */
const ZH_COMMON = new Set([
  "东方", "和平", "前进", "建设", "团结", "胜利", "新兴", "长安", "太平",
  "永安", "兴隆", "光明", "幸福", "民主", "文明", "新华", "红旗", "长征",
  "向阳", "东风", "红星", "红光", "曙光", "黎明", "振兴", "富强", "工农",
  "太阳", "阳光", "白云", "清水", "石桥", "双河", "大山", "新乡",
  "中华", "中央", "中国", "环球", "国际", "亚洲", "世界",
  "中心", "新城", "新区", "城区", "广场", "公园", "工业", "开发", "园区",
]);

/* ────────────────────────── 工具 ────────────────────────── */

/** 归一化：只留字母数字和汉字，其余（空格、连字符、下划线、中点）全部去掉。 */
function norm(input) {
  return (input || "").toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5]/g, "");
}

/** 拉丁词边界版本：保留空格，供「按词匹配」用。 */
function normSpaced(input) {
  return (input || "")
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, " ")
    .trim();
}

const hasCJK = (s) => /[\u4e00-\u9fa5]/.test(s);

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：小、快、确定性够用。 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KM_PER_DEG = 111.32;

/**
 * 省域兜底半径（公里）。
 *
 * 只在查不到省会时用。大陆各省一律走「省会城市 + 城市半径」，
 * 不用省域尺度的大圈：省级台绝大多数就设在省会（云南交通广播在昆明、
 * 安徽音乐广播在合肥），80 km 的圈把「在省里」画成了「到处都可能」，
 * 反而不如收紧到省会准确。
 */
const PROVINCE_RADIUS = 80;

/**
 * 城市规模 → 抖动半径（公里）。
 *
 * 数值偏大是有原因的：这个半径决定「同城的几个台在地图上分不分得开」。
 * z5.5 左右的分辨率约 3 km/px，半径 16 km 时六个点全挤在 5px 内，看起来就是
 * 一个点——正好是用户明确不想要的「集中在一个点」。
 * 取到 40 km，同一个城市的台在地图上能拉开十几像素，各自可点。
 */
function radiusFor(pop) {
  if (pop >= 3_000_000) return 40;
  if (pop >= 500_000) return 26;
  if (pop >= 100_000) return 15;
  return 10;
}

function kmBetween(a, b) {
  const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
  const dy = (a.lat - b.lat) * KM_PER_DEG;
  const dx = (a.lon - b.lon) * KM_PER_DEG * cosLat;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 中国大陆的大致矩形。用来一眼否掉「大西洋上的广东台」这类明显错到海外的坐标。 */
const CN_BOX = { latMin: 3, latMax: 54, lonMin: 73, lonMax: 136 };

function hostOf(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/* ────────────────────────── 匹配器 ────────────────────────── */

export async function loadCnGeo() {
  const raw = JSON.parse(await readFile(PLACES, "utf8"));
  const brandFile = JSON.parse(await readFile(BRANDS, "utf8"));

  /** 中文名 → 城市（同名取人口最多，数据生成时已去重，这里兜一手） */
  const byZh = new Map();
  /** 拉丁名 → 城市 */
  const byLatin = new Map();

  for (const p of raw.places) {
    /*
     * 每个中文别名都是一条匹配键，不只注册主名。
     * 百色的别名表里「百城」（镇旧称）排在「百色」前面，
     * 只认主名就会把「百色音乐广播」判成广西而非百色。
     */
    for (const name of p.za ?? (p.z ? [p.z] : [])) {
      const prev = byZh.get(name);
      if (!prev || p.p > prev.p) byZh.set(name, p);
    }
    for (const a of p.a) {
      const prev = byLatin.get(a);
      if (!prev || p.p > prev.p) byLatin.set(a, p);
    }
  }

  /** 中文键按长度倒序，保证「广州」不会被「广」之类的短键抢走 */
  const zhKeys = [...byZh.keys()]
    .filter((k) => k.length >= ZH_MIN_LEN && !ZH_COMMON.has(k))
    .sort((a, b) => b.length - a.length);

  /** 拉丁键只留够长的，短拼音误伤太多 */
  const latinKeys = [...byLatin.keys()]
    .filter((k) => k.length >= 5)
    .sort((a, b) => b.length - a.length);

  /** 省名 → 省对象 */
  const byProvinceName = new Map(PROVINCES.map((p) => [p.name, p]));

  /* --- 省名匹配索引 --- */

  /** 省级别名（用于台名子串匹配），长的先试：「内蒙古」不能被「内蒙」抢走 */
  const provinceKeys = [];
  for (const p of PROVINCES) {
    for (const k of p.alias) {
      provinceKeys.push({ key: norm(k), spaced: normSpaced(k), province: p });
    }
  }
  provinceKeys.sort((a, b) => b.key.length - a.key.length);

  /**
   * 整值匹配索引：state 字段整个就等于某个别名或缩写时用。
   * 同一个 key 落到两个省就是歧义（shx/sx 这类），两边都不要。
   */
  const exactIndex = new Map();
  for (const p of PROVINCES) {
    for (const k of [...p.alias, ...p.abbr]) {
      const key = norm(k);
      if (!key) continue;
      const prev = exactIndex.get(key);
      exactIndex.set(key, prev && prev !== p ? null : p);
    }
  }

  /** 拼音：用来把 state 里的三字母缩写（hun / zhe）补全成省名 */
  const pinyinOf = new Map(PROVINCES.map((p) => [p.name, norm(p.alias[0])]));

  /** 品牌词典，匹配串提前归一化 */
  const brands = (brandFile.items ?? []).map((b) => ({
    ...b,
    keys: (b.m ?? []).map(norm).filter(Boolean),
  }));

  /**
   * 从一段文字里认城市。
   *
   * 中文优先（更准），拉丁兜底。返回命中的最长地名对应的城市。
   */
  function findCity(text) {
    const z = norm(text);
    if (!z) return null;

    /*
     * 省名在这段文字里占的区间。
     *
     * 两字城市名落在省名内部时，那通常是省名被切开的一半，不是城市：
     *   「广【东城】市之声」「辽【宁乡】村广播」「黑【龙江】卫视伴音」
     * 直接按城市匹配会把它们甩到重庆东城、湖南宁乡、齐齐哈尔龙江县去。
     * 只有省名后面紧跟「市」时才放行——那写的是城市（吉林市）。
     */
    const provSpans = [];
    for (const { key } of provinceKeys) {
      if (!key || !hasCJK(key)) continue;
      for (let at = z.indexOf(key); at >= 0; at = z.indexOf(key, at + 1)) {
        provSpans.push({ start: at, end: at + key.length });
      }
    }

    // 中文：按长度从长到短扫，第一个命中就是最具体的（「佛山」优先于「山」这类短键）
    for (const key of zhKeys) {
      const at = z.indexOf(key);
      if (at < 0) continue;
      // 两字地名只认出现在靠前位置的，避免「东方音乐」配到海南东方市
      if (key.length === 2 && at >= ZH_SHORT_HEAD) continue;
      if (key.length === 2) {
        const span = provSpans.find((s) => at < s.end && at + 2 > s.start);
        if (span && z[span.end] !== "市") continue;
      }
      const hit = byZh.get(key);
      if (!hit) continue;
      // 两字同名点太多（人口为 0 的县城遍地重名），要求城市规模够大才算数
      if (key.length === 2 && hit.p < ZH_SHORT_MIN_POP) continue;
      /*
       * label 用「命中的那个写法」，而不是城市表里的主名。
       * 主名是按长度挑出来的，佛山的别名里就挑到了日文的「仏山」。
       * 命中的键一定出现在台名里，用它显示至少和用户的认知一致。
       *
       * via 的前缀用「城:」，和 findProvince 的「名:」区分开：
       * 两条路径都会命中中文词，报表里必须能一眼看出这条是城市级还是省级。
       */
      return { place: hit, via: `城:${key}`, label: key.replace(/(市|县|区)$/u, "") };
    }

    // 拉丁：要求完整词，避免 anshan 命中 chengduanshan 之类
    const spaced = normSpaced(text);
    if (spaced) {
      const words = ` ${spaced} `;
      for (const key of latinKeys) {
        if (words.includes(` ${key} `)) {
          const hit = byLatin.get(key);
          if (hit) return { place: hit, via: `en:${key}`, label: hit.z || hit.n };
        }
      }
      // 台名常把拼音连写成一个词（guangzhouradio），再兜一次子串匹配
      for (const key of latinKeys) {
        if (key.length >= 7 && z.includes(key)) {
          const hit = byLatin.get(key);
          if (hit) return { place: hit, via: `en+:${key}`, label: hit.z || hit.n };
        }
      }
    }
    return null;
  }

  /** 从一段文字里认省。cjk 表示「命中的是汉字写法」，见 resolveStation 里的用法。 */
  function findProvince(text) {
    const z = norm(text);
    if (!z) return null;
    const spaced = ` ${normSpaced(text)} `;
    for (const { key, spaced: sp, province } of provinceKeys) {
      if (!key) continue;
      // 含汉字的键直接子串匹配；纯拉丁键要求词边界，否则 shanxi 会命中 shanxidong
      if (hasCJK(key)) {
        if (z.includes(key)) return { province, cjk: true };
      } else if (spaced.includes(` ${sp} `) || z.endsWith(key)) {
        return { province, cjk: false };
      }
    }
    return null;
  }

  /**
   * 从 state 字段认省。
   *
   * 这一列是整个库里最脏的字段，实测过的写法：
   *   Guangdong / Kwangtung / gd / guang dong / 广东 / Hunan / hun / hunan sheng
   * 所以按「越严格越先试」分四步：整值 → 词边界 → 唯一前缀。全程不猜：
   * 命中两个省就当没认出来。
   */
  function provinceFromState(state) {
    const z = norm(state);
    if (!z) return null;

    const exact = exactIndex.get(z);
    if (exact) return { province: exact, via: `state:${state}` };

    const spaced = ` ${normSpaced(state)} `;
    for (const { key, spaced: sp, province } of provinceKeys) {
      if (!key || hasCJK(key)) continue;
      if (key.length >= 4 && spaced.includes(` ${sp} `)) {
        return { province, via: `state:${state}` };
      }
    }

    /*
     * 三四个字母、且是某个省拼音的开头——「hun」→ hunan。
     * 必须唯一命中：gua 同时是 guangdong / guangxi 的前缀，那就当没看见。
     */
    if (z.length >= 3 && z.length <= 4 && /^[a-z]+$/.test(z)) {
      const hits = PROVINCES.filter((p) => pinyinOf.get(p.name).startsWith(z));
      if (hits.length === 1) return { province: hits[0], via: `state~:${state}` };
    }

    return null;
  }

  /** 离给定坐标最近的居民点，用于「有真实坐标但没有归属」时反查省份。 */
  function nearestPlace(lat, lon, maxKm = 60) {
    let best = null;
    let bestKm = Infinity;
    for (const p of raw.places) {
      // 粗筛：经纬度差 0.6° 已经超过 60km，省掉大半计算
      if (Math.abs(p.lat - lat) > 0.6 || Math.abs(p.lon - lon) > 0.6) continue;
      const d = kmBetween(p, { lat, lon });
      if (d < bestKm) {
        bestKm = d;
        best = p;
      }
    }
    return best && bestKm <= maxKm ? { place: best, km: bestKm } : null;
  }

  /** 域名线索：主页优先，其次流地址（有的台把流地址当主页填）。 */
  function domainProvince(station) {
    for (const url of [station.homepage, station.url]) {
      const host = hostOf(url);
      if (!host) continue;
      for (const [suffix, name] of DOMAIN_HINTS) {
        if (host === suffix || host.endsWith(`.${suffix}`)) {
          const province = byProvinceName.get(name);
          if (province) return { province, via: `域名:${suffix}` };
        }
      }
    }
    return null;
  }

  return {
    places: raw.places,
    brands,
    byZh,
    byProvinceName,
    findCity,
    findProvince,
    provinceFromState,
    nearestPlace,
    domainProvince,
    radiusFor,
  };
}

/* ────────────────────────── 归属解析 ────────────────────────── */

/**
 * 省 → 省会城市。
 *
 * 不按「省名当城市名」去查（`findCity("广东")` 很可能命中某个叫「广东」的村镇），
 * 而是在地址库里找离省会坐标最近、人口最多的那个点。PROVINCES 里写的
 * 本来就是省会坐标，所以这个窗口一定落在省会城区。
 *
 * 返回的 kind 一律是 "city"，好让它们和「台名直接命中省会」的台分到同一组——
 * 否则同一座城市会拆成两个散点组，两组互不相让，点上直接叠在一起。
 */
function capitalFor(geo, province) {
  /*
   * 先按写死的省会名找点。省会是行政事实，不是人口排序的结果：
   * 台湾的中心点附近新北有 400 万人、台北只有 265 万，纯按人口挑会把
   * 一百多个台湾台全标成「新北」。
   */
  const capName = CAPITALS[province.name];
  let best = null;
  if (capName) {
    for (const p of geo.places) {
      if (p.pv !== province.name) continue;
      const named = p.z === capName || (p.za ?? []).includes(capName);
      if (!named) continue;
      if (!best || p.p > best.p) best = p;
    }
  }

  // 省会名在表里找不到（港澳台的城市点是手补的，可能缺）就退回最近的大居民点
  if (!best) {
    for (const p of geo.places) {
      if (p.pv !== province.name) continue;
      const d = kmBetween(p, province);
      if (d > 30) continue;
      if (!best || p.p > best.p) best = p;
    }
  }

  if (best) {
    return {
      anchor: best,
      city: best.z || province.name,
      radius: geo.radiusFor(best.p),
      kind: "city",
      provincial: true,
    };
  }
  return {
    anchor: province,
    city: null,
    radius: PROVINCE_RADIUS,
    kind: "province",
    provincial: true,
  };
}

/**
 * 给一条电台解析归属。
 *
 * 返回 null 表示一条地名线索都没有——那多半是「华语金曲 500 首」「雨声轻音乐」
 * 这类网络台，本来就没有物理位置。不给坐标，也就不上图：硬塞一个「大概在北京」
 * 进去，用户点开的是一张写着位置的卡片，而那个位置是编的。
 *
 * confidence 分三档，落库之后前端和报表都要用：
 *   high   台名 / state / 官方台呼直接写明，或该国只有唯一省级归属
 *   medium 域名、拼音前缀、系列品牌这类推断
 */
export function resolveStation(geo, station) {
  const name = station.name || "";
  const nameNorm = norm(name);

  // 1. 国家级 → 北京
  if (NATIONAL.some((k) => nameNorm.includes(norm(k)))) {
    const beijing = geo.byProvinceName.get("北京");
    /*
     * 半径 38 km 是北京市域的尺度。
     *
     * 库里挂在 CN 名下的央视、CNR、CRI 各频道加起来有四十多个，
     * 全塞进 20 km 的圈里，拒绝采样放不下就只能允许重叠，
     * 结果是一个点上堆着七八个台，点谁全看绘制顺序。
     */
    return {
      province: beijing,
      city: "北京",
      anchor: beijing,
      radius: 38,
      kind: "national",
      source: "national",
      confidence: "high",
    };
  }

  /*
   * 2. 品牌台呼。
   *
   * 排在台名城市之前：品牌名里可能含城市同形词——「珠江经济台」的「珠江」
   * 在云南有个同名乡镇，先认城市就会把它甩到云南去。
   */
  for (const brand of geo.brands) {
    if (!brand.keys.some((k) => nameNorm.includes(k))) continue;
    const province = geo.byProvinceName.get(brand.pv);
    if (!province) continue;
    const cityPlace = brand.city ? geo.byZh.get(brand.city) : null;
    const anchor = cityPlace ? { lat: cityPlace.lat, lon: cityPlace.lon } : province;
    return {
      province,
      city: brand.city || null,
      anchor,
      radius: geo.radiusFor(cityPlace?.p ?? 2_000_000),
      kind: cityPlace ? "city" : "province",
      source: `brand:${brand.m[0]}`,
      confidence: brand.conf || "medium",
      provincial: !cityPlace,
    };
  }

  // 3. 台名里的城市（最强信号）
  const byName = geo.findCity(name);
  if (byName) {
    const province = geo.byProvinceName.get(byName.place.pv) ?? null;
    return {
      province,
      city: byName.label || byName.place.z || byName.place.n,
      anchor: byName.place,
      radius: geo.radiusFor(byName.place.p),
      kind: "city",
      source: byName.via,
      confidence: "high",
    };
  }

  /*
   * 4. 台名里明确写出的中文省名。排在 state 之前。
   *
   * 「陕西交通广播」的 state 填的是 Shanxi——那是山西的拼音，而陕西的旧拼法
   * 也是 Shanxi。按 state 走会把它判到太原。台名写的是汉字，没有这个歧义。
   * 只认汉字命中：拉丁写法（Guangdong Radio）仍交给 state 判断，词边界太容易误伤。
   */
  const nameProv = geo.findProvince(name);
  if (nameProv?.cjk) {
    return {
      ...capitalFor(geo, nameProv.province),
      province: nameProv.province,
      source: `名:${nameProv.province.name}`,
      confidence: "high",
    };
  }

  /*
   * 5. state 字段。
   *
   * 两种解释都要试，但**必须先省后城**。反过来会出事：
   * 「天籁之音」的 state 是 Honan，而洛阳的别名里正好有 honan（河南府），
   * 先当城市匹配就会把它判到洛阳去。state 的语义毕竟是「省」，
   * 只有当它压根不是省名时（Dalian）才退化成城市。
   */
  const state = station.state || "";
  if (state) {
    const stProv = geo.provinceFromState(state);
    if (stProv) {
      return {
        ...capitalFor(geo, stProv.province),
        province: stProv.province,
        source: stProv.via,
        confidence: "high",
      };
    }
    const stCity = geo.findCity(state);
    if (stCity) {
      const province = geo.byProvinceName.get(stCity.place.pv) ?? null;
      return {
        province,
        city: stCity.label || stCity.place.z || stCity.place.n,
        anchor: stCity.place,
        radius: geo.radiusFor(stCity.place.p),
        kind: "city",
        source: `state:${stCity.via}`,
        confidence: "medium",
      };
    }
  }

  // 6. 台名里的省（拉丁写法兜底）
  if (nameProv) {
    return {
      ...capitalFor(geo, nameProv.province),
      province: nameProv.province,
      source: `名:${nameProv.province.name}`,
      confidence: "medium",
    };
  }

  /*
   * 7. 一国即一省。港澳台只有唯一省级归属，国家代码本身就是答案，
   *    不需要任何推断——但只知道省，落点只能给省会。
   */
  const byCountry = PROVINCE_BY_COUNTRY.get(station.countryCode || "");
  if (byCountry) {
    return {
      ...capitalFor(geo, byCountry),
      province: byCountry,
      source: `国家:${byCountry.country}`,
      confidence: "high",
    };
  }

  // 8. 域名
  const byDomain = geo.domainProvince(station);
  if (byDomain) {
    return {
      ...capitalFor(geo, byDomain.province),
      province: byDomain.province,
      source: byDomain.via,
      confidence: "medium",
    };
  }

  return null;
}

/**
 * 只算归属，不碰坐标。给富化产物用。
 *
 * 与 resolveStation 的区别：这里会补一步「有真实坐标就反查最近居民点」，
 * 因为富化表要覆盖所有台，包括那些坐标本来就没问题的台——
 * 它们以前只被算了一个坐标，从来没有「属于哪个省」这条事实。
 */
export function enrichStation(geo, station) {
  const found = resolveStation(geo, station);

  if (found?.province) {
    return {
      province: found.province,
      city: found.city ?? null,
      source: found.source,
      confidence: found.confidence,
      /*
       * 精度。省会和省级台都落在省会，city 一定填得上，但那是「推测它在该省省会」，
       * 不是「知道它在这座城市」。不把这两者分开，报表上的「市级覆盖率」会虚高到
       * 和省级覆盖率一模一样——那正是最容易骗自己的数字。
       */
      precision: found.provincial ? "province" : "city",
    };
  }

  const lat = station.lat;
  const lon = station.lon;
  if (typeof lat === "number" && typeof lon === "number" && lat && lon) {
    const near = geo.nearestPlace(lat, lon, 60);
    if (near) {
      const province = geo.byProvinceName.get(near.place.pv) ?? null;
      if (province) {
        return {
          province,
          city: near.place.z || near.place.n || null,
          source: "coord",
          confidence: near.km <= 20 ? "high" : "medium",
          precision: "city",
        };
      }
    }
  }

  return { province: null, city: null, source: "none", confidence: "low", precision: "none" };
}

/**
 * 给一批电台分配坐标，并在对象上写归属。
 *
 * 输入是同一座城市（或同一个省级代表点）下的所有台，输出直接在入参对象上
 * 写 lat / lon / place / approx。用泊松式拒绝采样把同城的台散开，
 * 但种子来自 station.id，所以同样的输入永远得到同样的输出。
 */
export function scatter(group, anchor, radiusKm, place) {
  const cosLat = Math.cos((anchor.lat * Math.PI) / 180) || 1e-6;
  const minGapKm = radiusKm * 0.42;
  const placed = [];

  for (const station of group) {
    const rand = prng(hashSeed(station.id));
    let pickPoint = null;
    let fallback = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      const r = radiusKm * Math.sqrt(rand());
      const theta = rand() * Math.PI * 2;
      const lat = anchor.lat + (r * Math.cos(theta)) / KM_PER_DEG;
      const lon = anchor.lon + (r * Math.sin(theta)) / (KM_PER_DEG * cosLat);

      let nearest = Infinity;
      for (const q of placed) {
        const dy = (lat - q.lat) * KM_PER_DEG;
        const dx = (lon - q.lon) * KM_PER_DEG * cosLat;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearest) nearest = d;
      }

      if (nearest >= minGapKm) {
        pickPoint = { lat, lon };
        break;
      }
      // 全程都挤不开时退而求其次：记住最宽松的那个位置
      if (!fallback || nearest > fallback.gap) fallback = { lat, lon, gap: nearest };
    }

    const point = pickPoint ?? fallback ?? { lat: anchor.lat, lon: anchor.lon };
    placed.push(point);

    station.lat = Math.round(point.lat * 1e4) / 1e4;
    station.lon = Math.round(point.lon * 1e4) / 1e4;
    station.approx = 1;
    station.place = place;
  }

  return group.length;
}

/**
 * 给整批中国（含港澳台）电台推断坐标与归属。
 *
 * 已经有真实坐标的台原样保留（approx = 0），只给缺坐标的补。
 * 推断不出来的保持无坐标，它们不上图——硬塞一个位置等于凭空捏造。
 *
 * 无论坐标是不是真的，province / city / geoSource / geoConfidence 都会写上，
 * 这是「位置」和「归属」两件事的分界线：坐标可以没有，归属照样要有。
 */
export async function inferChinaGeo(stations) {
  const geo = await loadCnGeo();

  /** 待推断的台按「落点」分组，同组一起散开 */
  const groups = new Map();
  const stats = {
    real: 0,
    coord: 0,
    national: 0,
    brand: 0,
    city: 0,
    province: 0,
    country: 0,
    domain: 0,
    none: 0,
    rejected: 0,
  };

  /*
   * 线索来源 → 统计桶。日志里要能看出「多少个台是靠品牌词典救回来的」，
   * 所以桶按来源划分，而不是按最终有没有坐标划分。
   */
  const bucketOf = (source) => {
    if (source === "national") return "national";
    if (source === "coord") return "coord";
    if (source.startsWith("brand:")) return "brand";
    if (source.startsWith("域名:")) return "domain";
    if (source.startsWith("国家:")) return "country";
    // state 退化成城市时，via 里嵌着「城:」或「en:」两套前缀
    if (source.startsWith("state:")) {
      return /^state:(城:|en)/.test(source) ? "city" : "province";
    }
    if (source.startsWith("城:") || source.startsWith("en")) return "city";
    if (source.startsWith("名:")) return "province";
    return "none";
  };

  const push = (key, station, anchor, radius, place) => {
    const g = groups.get(key);
    if (g) g.items.push(station);
    else groups.set(key, { items: [station], anchor, radius, place });
  };

  for (const station of stations) {
    const found = resolveStation(geo, station);

    if (found) {
      station.province = found.province?.name ?? null;
      station.provinceCode = found.province?.code ?? null;
      station.city = found.city ?? null;
      station.geoSource = found.source;
      station.geoConfidence = found.confidence;
      /*
       * 城市那个值是可用的还是只是省会的替代品，得分开记。
       * 卡片上写「位置为估算 · 台北」而实际只知道「台湾」，就是在撒谎。
       */
      station.geoPrecision = found.provincial ? "province" : "city";
    }

    if (station.lat && station.lon) {
      const inBox =
        station.lat >= CN_BOX.latMin &&
        station.lat <= CN_BOX.latMax &&
        station.lon >= CN_BOX.lonMin &&
        station.lon <= CN_BOX.lonMax;

      /*
       * 交叉校验。众包坐标里错得很离谱的不少：
       * 「广东音乐之声」标在大西洋（39N 36W），「CRI环球资迅广播」标在浙江山沟里。
       * 两条判据——
       *   - 出了国境框：直接不认
       *   - 台名能指出城市，但坐标离那座城市几百公里：不认
       * 只到省一级的推断（provincial）不做距离校验：台名只说了「云南」，
       * 真实坐标在大理、丽江都是对的，拿省会的 300 km 去卡会误杀。
       */
      const tolerance = found?.kind === "national" ? 500 : 300;
      const nearAnchor =
        !found ||
        found.provincial ||
        found.kind === "province" ||
        kmBetween(station, found.anchor) <= tolerance;

      if (inBox && nearAnchor) {
        station.approx = 0;
        stats.real++;
        // 有坐标没归属的，反查最近的居民点补上
        if (!found) {
          const near = geo.nearestPlace(station.lat, station.lon, 60);
          const province = near ? geo.byProvinceName.get(near.place.pv) : null;
          if (province) {
            station.province = province.name;
            station.provinceCode = province.code;
            station.city = near.place.z || near.place.n || null;
            station.geoSource = "coord";
            station.geoConfidence = near.km <= 20 ? "high" : "medium";
            station.geoPrecision = "city";
            stats.coord++;
          } else {
            station.geoSource = "real";
            station.geoConfidence = "high";
            station.geoPrecision = "city";
          }
        }
        station.place = station.city ?? null;
        continue;
      }

      // 坐标不认，但台名给出的落点还能用，就走推断
      station.lat = null;
      station.lon = null;
      stats.rejected++;
    }

    if (!found) {
      /*
       * 一条地名线索都没有。
       *
       * 这类台多半是「华语金曲 500 首」「雨声轻音乐」这种网络台，本来就没有
       * 物理位置。不给坐标，也就不上图。
       */
      station.province = null;
      station.provinceCode = null;
      station.city = null;
      station.geoSource = "none";
      station.geoConfidence = "low";
      station.geoPrecision = null;
      stats.none++;
      continue;
    }

    stats[bucketOf(found.source)]++;

    const { anchor, radius, source } = found;
    const place = found.city ?? found.province?.name ?? null;
    station.place = place;

    if (found.kind === "national") {
      push("cn:national", station, anchor, radius, place);
    } else if (found.kind === "city") {
      push(`city:${anchor.lat},${anchor.lon}`, station, anchor, radius, place);
    } else {
      push(`prov:${place}`, station, anchor, radius, place);
    }
  }

  let scattered = 0;
  for (const g of groups.values()) scattered += scatter(g.items, g.anchor, g.radius, g.place);

  return { stats, scattered, groupCount: groups.size, geo };
}
