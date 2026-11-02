import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { buildBrowseGroups, OTHER_REGION } = await importTs("../src/lib/browseGroups.ts");

const station = (id, extra = {}) => ({
  id,
  name: `台 ${id}`,
  countryCode: "CN",
  countryName: "中国",
  province: null,
  state: null,
  city: null,
  clicks: 0,
  ...extra,
});

const stations = [
  station("cs1", { province: "湖南", city: "长沙", clicks: 30 }),
  station("cs2", { province: "湖南", city: "长沙", clicks: 20 }),
  station("yy", { province: "湖南", city: "岳阳", clicks: 10 }),
  station("bj", { province: "北京", city: "北京", clicks: 5 }),
  station("fr1", { countryCode: "FR", countryName: "法国", state: "Île-de-France" }),
  station("fr2", { countryCode: "FR", countryName: "法国", state: "Île-de-France" }),
  station("us", { countryCode: "US", countryName: "" }),
];

test("国家按数量降序，内部按省/州分组，并收集城市", () => {
  const groups = buildBrowseGroups(stations);
  assert.deepEqual(groups.map((g) => g.code), ["CN", "FR", "US"]);

  const china = groups[0];
  assert.equal(china.name, "中国");
  assert.equal(china.count, 4);
  assert.deepEqual(china.regions.map((r) => [r.name, r.count]), [["湖南", 3], ["北京", 1]]);

  const hunan = china.regions[0];
  assert.deepEqual(hunan.cities.map((c) => [c.name, c.count]), [["长沙", 2], ["岳阳", 1]]);
});

test("境外按 state 分组，没有 state 的归到「其他」", () => {
  const groups = buildBrowseGroups(stations);
  const france = groups.find((g) => g.code === "FR");
  assert.deepEqual(france.regions.map((r) => r.name), ["Île-de-France"]);
  assert.deepEqual(france.regions[0].cities, []);

  const usa = groups.find((g) => g.code === "US");
  assert.deepEqual(usa.regions.map((r) => r.name), [OTHER_REGION]);
  assert.equal(usa.name, "美国", "缺 countryName 时用 Intl 补上");
});

test("空输入返回空数组", () => {
  assert.deepEqual(buildBrowseGroups([]), []);
});
