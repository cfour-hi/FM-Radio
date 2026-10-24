#!/usr/bin/env node
/*
 * 生成「中国城市坐标表」，给电台归属解析用。
 *
 * 背景：radio-browser 里中国有 2400 多个台，带合法经纬度的只有二三十个。
 * 但台名和 state 字段里的地名信息很密（「佛山电台」「广东广播电视台」「CCTV-13」），
 * 够反推出台在哪个城市。这样地图上中国才不会只剩沿海孤零零几个点。
 *
 * 除了坐标，这里还要给每个城市写上**它属于哪个省**（字段 pv）。
 * 这是「富化」和「定位」两个需求的分界点：没有 pv，就只能算出坐标，
 * 产不出「这个台是湖南的」这条事实，列表页和筛选也就无从谈起。
 *
 * 数据源是 GeoNames 的 CN 数据集（CC BY 4.0）。只取建成区级别的点位：
 * 各级行政驻地（省 / 地级 / 县 / 乡镇）加上人口较多的居民点。村庄一律丢掉——
 * 86 万个 PPL 里绝大多数是自然村，拿它们当候选会让「朝阳」这种词匹配到几十个地方。
 *
 * 这份表只在构建期用，不进前端包，所以体积不敏感，保留全部别名以提高命中率。
 *
 * 用法：
 *   curl -sLO https://download.geonames.org/export/dump/CN.zip && unzip CN.zip
 *   node scripts/build-cn-places.mjs CN.txt
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HKMO_TW_PLACES, PROVINCE_BY_GN } from "./cn-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "data/cn-places.json");

/**
 * 有行政意义的 feature code。PPL 只有人口够多才收。
 *
 * 刻意不收 PPLA4（乡镇驻地）：全国有一万两千多个，名字里「太平」「长安」「兴隆」
 * 「三岔河」这类通用词遍地都是，会让「长安汽车音乐台」匹配到某个乡镇去。
 * 电台本来就设在县城以上，乡镇级对提高命中率没帮助，只会加噪声。
 */
const ADMIN_CODES = new Set(["PPLC", "PPLA", "PPLA2", "PPLA3"]);
/** 普通居民点的门槛。低于这个数基本是村子。 */
const PPL_MIN_POP = 20000;

const CJK = /[\u4e00-\u9fa5]/;
const hasCJK = (s) => CJK.test(s);

/**
 * 别名清洗。
 *
 * 只要两类：纯中文名（用来配「佛山电台」），以及罗马化拼写（用来配「Guangzhou Radio」）。
 * 其他语言的别名（维吾尔文、藏文、俄文）在这里没用，反而会把匹配键撑大几倍。
 *
 * 中文这边有两条过滤，都是踩坑加的：
 *   - 丢掉「XX街道」「XX镇」「XX村」这类下级地名。百色的别名里「百城街道」
 *     排在「百色」前面，不去掉的话长名优先会先把街道名匹配上去。
 *   - 限定 2–5 字。中文城市名加上「市」最多五个字（呼和浩特市、乌鲁木齐市）。
 */
const SUBORDINATE = /(街道|社区|村|居委会|镇)$/u;

/**
 * 日文专用汉字。
 *
 * GeoNames 的别名表里混着日文写法：佛山的「仏山」、广州的「広州」。
 * 它们和简体名同长度，排序时常常排在前面，一命中就会显示成
 * 「位置为估算 · 仏山」。这些字在简体中文里一个都不用，直接按字过滤最省事。
 */
const JP_ONLY = /[仏広沢県駅桜竜浜稲塚渋瀬塩縁恵徳悪圧変売読転軽鉄銭関図団対応発経験権戦単帰気楽薬]/u;

/**
 * 假名。
 *
 * 光有 JP_ONLY 那批汉字不够：日文别名常写成「ウルムチ市」「ソウル」这种
 * 片假名 + 汉字后缀的混写，`hasCJK` 只看「含不含汉字」，带了「市」字就算中文名，
 * 于是乌鲁木齐的主名一度被记成了「ウルムチ」。凡是含假名的一律不算中文别名。
 */
const KANA = /[\u3040-\u30ff]/u;

function cleanAliases(raw) {
  const out = new Set();
  for (const item of raw.split(",")) {
    const a = item.trim();
    if (!a) continue;
    if (hasCJK(a)) {
      if (SUBORDINATE.test(a) || JP_ONLY.test(a) || KANA.test(a)) continue;
      /*
       * 「中国上海」这类带国名前缀的写法要去掉。
       * 上海那条记录的中文别名是 ["上海","上海市","中国上海"]，选名规则取最长，
       * 结果卡片上写出「位置为估算 · 中国上海」。整个数据集里只有上海这一条这么写，
       * 但规则本身就该排除国名前缀。
       */
      if (a.length > 2 && a.startsWith("中国")) continue;
      // 「广州市」→ 同时保留「广州」，台名两种写法都有
      const bare = a.replace(/(市|县|区|镇|乡|自治州|自治县|地区|盟|旗)$/u, "");
      if (bare.length >= 2) out.add(bare);
      if (a.length >= 2 && a.length <= 5) out.add(a);
    } else if (/^[A-Za-z][A-Za-z\s'.-]{1,40}$/.test(a)) {
      const key = a.toLowerCase().replace(/[^a-z]/g, "");
      if (key.length >= 3) out.add(key);
    }
  }
  return [...out];
}

/**
 * 从多个中文写法里挑一个当显示名。
 *
 * 难点是 GeoNames 的别名表里繁简混排，而且顺序不可信：
 * 贵阳写成 ["貴陽","貴陽市","贵阳","贵阳市"]，重庆却是 ["重庆","重庆市","重慶","重慶市"]。
 * 取数组第一个，两个省会里就有一个显示成「貴陽」。
 *
 * 不维护繁简对照表，改用「这个字在全表里出现多少次」来判断：
 * 简体写法在大陆地名里出现得多得多（贵 225 次 vs 貴 44 次，银 75 vs 銀 72）。
 * 同长度时比分值，长度仍然优先——保留「全称比简称更像正式名」的原意。
 */
function displayName(all, freq) {
  const score = (s) => [...s].reduce((n, ch) => n + (freq.get(ch) ?? 0), 0);
  const cands = all.filter((a) => a.length >= 2);
  if (!cands.length) return "";
  cands.sort((a, b) => b.length - a.length || score(b) - score(a));
  return cands[0].replace(/(市|县|区|镇|乡|自治州|自治县|地区|盟|旗)$/u, "");
}

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("用法：node scripts/build-cn-places.mjs <CN.txt>");
    process.exit(1);
  }

  const text = await readFile(src, "utf8");
  /** 先收原始条目，等全表扫完再定显示名——选名需要全表字频 */
  const kept = [];
  let scanned = 0;
  let skipped = 0;
  /** admin1 编码认不出省的点。正常应该是 0，非 0 说明 GeoNames 加了新编码 */
  let unknownAdmin1 = 0;

  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    if (f[6] !== "P") continue;
    scanned++;

    const code = f[7];
    const pop = Number(f[14]) || 0;
    const isAdmin = ADMIN_CODES.has(code);
    if (!isAdmin && pop < PPL_MIN_POP) {
      skipped++;
      continue;
    }

    const lat = Number(f[4]);
    const lon = Number(f[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // 港澳台有各自的 GeoNames 文件，这里只留大陆，避免同一座城出现两条
    if (lat < 3 || lat > 54 || lon < 73 || lon > 136) continue;

    const aliases = cleanAliases(f[3] ?? "");
    const zhAll = aliases.filter(hasCJK);
    const latin = new Set(
      [f[1], f[2], ...aliases.filter((a) => !hasCJK(a))]
        .filter(Boolean)
        .map((s) => s.toLowerCase().replace(/[^a-z]/g, ""))
        .filter((s) => s.length >= 3),
    );

    /*
     * 所属省。GeoNames 的第 11 列是 admin1 编码，用的是 FIPS 式编号
     * （11=湖南、22=北京、33=重庆），不是国标代码，映射表在 cn-admin.mjs。
     *
     * 认不出编码的点直接丢掉，而不是留一个空 pv：
     * 一个没有省的落点对富化毫无用处，留着只会让统计数字好看一点。
     */
    const province = PROVINCE_BY_GN.get(f[10] ?? "");
    if (!province) {
      unknownAdmin1++;
      continue;
    }

    kept.push({
      n: f[2] || f[1],
      za: zhAll,
      a: [...latin],
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      p: pop,
      pv: province.name,
    });
  }

  /** 汉字频次，只用来在同长度的多个写法里挑简体 */
  const freq = new Map();
  for (const k of kept) for (const a of k.za) for (const ch of a) freq.set(ch, (freq.get(ch) ?? 0) + 1);

  const places = kept.map((k) => ({ ...k, z: displayName(k.za, freq) }));

  /*
   * 港澳台的点单独并进来。
   *
   * 它们不在 CN.txt 里（有各自的 GeoNames 文件），但台名里「台北」「香港」
   * 「澳门」出现得很多，识别器必须能认。并进来之后 pv 自然指向
   * 香港 / 澳门 / 台湾，和大陆的点走完全一样的匹配路径，不需要特判。
   */
  for (const p of HKMO_TW_PLACES) {
    places.push({ ...p });
  }

  // 同一个中文名在多个城市出现（「朝阳」在北京也在辽宁、「太平」遍地都是）时，
  // 保留人口最多的那个。匹配阶段还会再按歧义规则筛一次。
  const byZh = new Map();
  for (const p of places) {
    for (const name of p.za) {
      const prev = byZh.get(name);
      if (!prev || p.p > prev.p) byZh.set(name, p);
    }
  }

  await mkdir(dirname(OUT), { recursive: true });
  const body = JSON.stringify({ source: "geonames.org CN (CC BY 4.0)", count: places.length, places });
  await writeFile(OUT, body);

  const zhCount = places.filter((p) => p.z).length;
  const cityCount = places.filter((p) => p.p >= 300000).length;
  const provCount = new Set(places.map((p) => p.pv)).size;
  console.log(`扫描 P 类 ${scanned} 条，跳过 ${skipped} 条非行政小村落`);
  console.log(`保留城市 ${places.length} 个（有中文名 ${zhCount}，人口≥30万 ${cityCount}），唯一中文名 ${byZh.size} 个`);
  console.log(`覆盖省级行政区 ${provCount} 个；admin1 编码认不出 ${unknownAdmin1} 条`);
  console.log(`最大人口 ${Math.max(...places.map((p) => p.p)).toLocaleString()}`);
  console.log(`文件 ${(body.length / 1024).toFixed(0)} KB → ${OUT}`);
}

await main();
