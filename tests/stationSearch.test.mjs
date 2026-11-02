import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { searchStations } = await importTs("../src/lib/stationSearch.ts");

/* ------------------------------------------------------------------ */
/* 带地区的搜索                                                        */
/* ------------------------------------------------------------------ */

/** 只造 searchStations 真正会读的字段，其余留空 */
function station(id, name, clicks, extra = {}) {
  return {
    id,
    name,
    clicks,
    province: null,
    city: null,
    state: null,
    countryName: "",
    countryCode: "",
    ...extra,
  };
}

test("台名前缀优先于台名包含，哪怕包含的那个更热门", () => {
  const stations = [
    station("contains", "Radio France", 100),
    station("prefix", "France Musique", 1),
  ];
  const { hits } = searchStations(stations, "fran");
  assert.deepEqual(hits.map((s) => s.id), ["prefix", "contains"]);
});

test("台名命中优先于地区命中", () => {
  const stations = [
    station("regional", "某某音乐台", 999, { province: "湖南", city: "长沙" }),
    station("named", "湖南交通广播", 1, { province: "湖南", city: "长沙" }),
  ];
  const { hits, regionTotal } = searchStations(stations, "湖南");
  assert.deepEqual(hits.map((s) => s.id), ["named", "regional"]);
  assert.equal(regionTotal, 1, "台名命中的那个不计入地区总数");
});

test("英文国名与中文国名都能搜到", () => {
  const stations = [station("fr", "B 台", 1, { countryCode: "FR", countryName: "France" })];
  assert.deepEqual(searchStations(stations, "france").hits.map((s) => s.id), ["fr"]);
  assert.deepEqual(searchStations(stations, "法国").hits.map((s) => s.id), ["fr"]);
});

test("按省份、城市、国家都能搜到，包括省市连写", () => {
  const stations = [
    station("hn", "A 台", 1, { province: "湖南", city: "长沙" }),
    station("fr", "B 台", 2, { countryCode: "FR", countryName: "" }),
  ];
  assert.deepEqual(searchStations(stations, "长沙").hits.map((s) => s.id), ["hn"]);
  assert.deepEqual(searchStations(stations, "湖南长沙").hits.map((s) => s.id), ["hn"]);
  assert.deepEqual(searchStations(stations, "法国").hits.map((s) => s.id), ["fr"]);
  assert.deepEqual(searchStations(stations, "fr").hits.map((s) => s.id), ["fr"]);
});

test("港澳台用规范全称，不依赖运行时的语言包写法", () => {
  const stations = [
    station("hk", "香港电台", 3, { province: "香港", countryCode: "HK" }),
    station("mo", "澳门电台", 2, { province: "澳门", countryCode: "MO" }),
    station("tw", "台湾电台", 1, { province: "台湾", countryCode: "TW" }),
  ];
  assert.deepEqual(searchStations(stations, "中国香港").hits.map((s) => s.id), ["hk"]);
  assert.deepEqual(searchStations(stations, "中国澳门").hits.map((s) => s.id), ["mo"]);
  assert.deepEqual(searchStations(stations, "中国台湾").hits.map((s) => s.id), ["tw"]);
});

test("地区命中另设上限，但回传真实总数", () => {
  const stations = Array.from({ length: 40 }, (_, i) =>
    station(`h${i}`, `台 ${i}`, 40 - i, { province: "湖南", city: "长沙" }),
  );
  const { hits, regionTotal } = searchStations(stations, "湖南", { regionLimit: 5 });
  assert.equal(hits.length, 5);
  assert.equal(regionTotal, 40, "上限只截断结果，不改总数");
  // 索引按热度降序，取到的应该是热度最高的前 5 个
  assert.deepEqual(hits.map((s) => s.id), ["h0", "h1", "h2", "h3", "h4"]);
});

test("单个字不触发地区匹配，只按台名找", () => {
  const stations = [station("fr", "B 台", 1, { countryCode: "FR" }), station("hn", "法 台", 2, { province: "湖南" })];
  const { hits, regionTotal } = searchStations(stations, "法");
  assert.equal(regionTotal, 0);
  assert.deepEqual(hits.map((s) => s.id), ["hn"], "只是台名里有个「法」字");
});

test("大小写与变音符号不影响匹配", () => {
  const stations = [station("sao", "São Paulo FM", 1), station("paris", "PARIS Jazz", 2)];
  assert.deepEqual(searchStations(stations, "sao").hits.map((s) => s.id), ["sao"]);
  assert.deepEqual(searchStations(stations, "paris").hits.map((s) => s.id), ["paris"]);
});

test("拼音、首字母与英文旧称都能命中", () => {
  const stations = [
    station("hn", "湖南交通广播", 10, {
      province: "湖南",
      pinyinName: ["hunanjiaotongguangbo", "hnjtgb"],
      pinyinPlace: ["hunan", "changsha"],
    }),
    station("bj", "北京新闻广播", 5, {
      province: "北京",
      pinyinName: ["beijingxinwenguangbo", "bjxwgb"],
      pinyinPlace: ["beijing"],
    }),
  ];

  assert.deepEqual(searchStations(stations, "hunan").hits.map((s) => s.id), ["hn"]);
  assert.deepEqual(searchStations(stations, "hnjt").hits.map((s) => s.id), ["hn"]);
  assert.deepEqual(searchStations(stations, "changsha").hits.map((s) => s.id), ["hn"]);
  assert.deepEqual(searchStations(stations, "beijing").hits.map((s) => s.id), ["bj"]);
  assert.deepEqual(searchStations(stations, "peking").hits.map((s) => s.id), ["bj"]);
});

test("不改变传入的数组顺序，空关键词不返回结果", () => {
  const stations = [
    station("a", "台 A", 1, { province: "湖南" }),
    station("b", "台 B", 9, { province: "湖南" }),
    station("c", "台 C", 5, { province: "湖南" }),
  ];
  const before = stations.slice();
  searchStations(stations, "湖南");
  assert.deepEqual(stations, before);
  assert.deepEqual(searchStations(stations, "   "), { hits: [], regionTotal: 0 });
});
