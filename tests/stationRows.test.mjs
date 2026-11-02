import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { decodeCatalogRows, decodeMapRows } = await importTs("../src/lib/stationRows.ts");

const mapRow = (extra = []) => [
  "id-1", "北京新闻广播", "https://example.com/radio.mp3", "CN", "中国", "MP3", 128,
  39.9, 116.4, 10, 0, 0, "", 0, "", "北京", "北京", 0, "chinese", "news",
  ...extra,
];

const catalogRow = (extra = []) => [
  "id-2", "爵士乐", "US", 5, "https://example.com/jazz.mp3", "english", "jazz",
  ...extra,
];

test("旧的 20 列地图行仍能解码，新字段为空", () => {
  const [station] = decodeMapRows([mapRow()]);
  assert.equal(station.id, "id-1");
  assert.equal(station.homepage, null);
  assert.equal(station.favicon, null);
  assert.deepEqual(station.pinyinName, []);
  assert.deepEqual(station.pinyinPlace, []);
});

test("24 列地图行解码主页、图标与拼音 token", () => {
  const [station] = decodeMapRows([
    mapRow(["https://example.com", "https://example.com/favicon.png", "beijingxinwenguangbo,bjxwgb", "beijing,peking"]),
  ]);
  assert.equal(station.homepage, "https://example.com");
  assert.equal(station.favicon, "https://example.com/favicon.png");
  assert.deepEqual(station.pinyinName, ["beijingxinwenguangbo", "bjxwgb"]);
  assert.deepEqual(station.pinyinPlace, ["beijing", "peking"]);
});

test("旧的 7 列 catalog 行仍能解码", () => {
  const [station] = decodeCatalogRows([catalogRow()]);
  assert.equal(station.countryName, "美国");
  assert.equal(station.homepage, null);
  assert.deepEqual(station.pinyinName, []);
});

test("11 列 catalog 行解码新字段", () => {
  const [station] = decodeCatalogRows([
    catalogRow(["https://example.com/jazz", "https://example.com/jazz.png", "jueshiyue,jsy", ""]),
  ]);
  assert.equal(station.homepage, "https://example.com/jazz");
  assert.equal(station.favicon, "https://example.com/jazz.png");
  assert.deepEqual(station.pinyinName, ["jueshiyue", "jsy"]);
  assert.deepEqual(station.pinyinPlace, []);
});
