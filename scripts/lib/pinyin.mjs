/*
 * 构建期的拼音/罗马化工具。
 *
 * 台名全拼依赖 pinyin-pro；没装时退化为「只生成地名罗马化」，不阻塞构建。
 * 地名罗马化来自 scripts/data/cn-places.json 和 cn-admin.mjs 的省别名，
 * 这些数据本来就在仓库里，不额外增加依赖。
 *
 * 产物是两组逗号分隔的 token，直接写进快照的新列：
 *   pyName  台名全拼 + 首字母（仅含汉字的台名）
 *   pyPlace 省/市/place 的罗马化 + 首字母
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVINCES } from "../cn-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLACES_FILE = resolve(HERE, "../data/cn-places.json");

const HAN = /\p{Script=Han}/u;

/** 只保留 ASCII 字母数字，便于搜索时统一 fold；中文别名会变成空串，自然被过滤。 */
const normalize = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "");

function addToken(set, value) {
  const token = normalize(value);
  if (token.length >= 2) set.add(token);
}

async function loadPlaces() {
  const raw = JSON.parse(await readFile(PLACES_FILE, "utf8"));
  const list = Array.isArray(raw) ? raw : (raw.places ?? raw.items ?? []);
  const byZh = new Map();

  for (const place of list) {
    const canonical = place.n || place.z || "";
    const names = [...(place.za ?? []), place.z].filter(Boolean);
    for (const zh of names) {
      // 只留规范罗马名。GeoNames 的 a 列表是几十年各种转写，全部写进快照
      // 会让一个北京台多出上千字符，gzip 后也是实打实的体积。
      byZh.set(zh, { canonical, province: place.pv ?? "" });
    }
  }
  return byZh;
}

const provinceAliases = new Map(
  PROVINCES.map((province) => [
    province.name,
    [...province.alias, ...province.abbr].map(normalize).filter((token) => token.length >= 2),
  ]),
);

/**
 * 返回构建脚本用的工具。
 * pinyin-pro 是可选依赖：动态 import 失败只警告，地名 token 仍然可用。
 */
export async function createPinyinTools() {
  let pinyin = null;
  try {
    const mod = await import("pinyin-pro");
    pinyin = mod.pinyin ?? mod.default?.pinyin ?? null;
  } catch {
    console.warn("  未安装 pinyin-pro：台名拼音留空，只生成地名罗马化");
  }

  const places = await loadPlaces();

  const addPinyin = (set, text) => {
    if (!pinyin || !HAN.test(text)) return;
    try {
      const full = pinyin(text, { toneType: "none", type: "array" });
      const initials = pinyin(text, { pattern: "first", toneType: "none", type: "array" });
      addToken(set, full.join(""));
      addToken(set, initials.join(""));
    } catch {
      /* 单条数据有问题不影响整批生成 */
    }
  };

  /** 台名全拼 + 首字母；不含汉字的台名返回空数组（英文名本身就能搜）。 */
  const nameTokens = (name) => {
    const tokens = new Set();
    addPinyin(tokens, name);
    return [...tokens];
  };

  /** 省、市、place 的罗马化与首字母。 */
  const placeTokens = (station) => {
    const tokens = new Set();
    for (const alias of provinceAliases.get(station.province) ?? []) addToken(tokens, alias);

    for (const zh of [station.city, station.place]) {
      if (!zh) continue;
      const entry = places.get(zh);
      if (entry?.canonical) addToken(tokens, entry.canonical);
      addPinyin(tokens, zh);
    }
    if (station.province) addPinyin(tokens, station.province);
    return [...tokens];
  };

  return { nameTokens, placeTokens };
}
