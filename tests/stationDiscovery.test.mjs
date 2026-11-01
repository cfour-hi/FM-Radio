import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { importTs } from "./tsLoader.mjs";
const { matchesFilters, languageOptions, randomPool, pickRandom } = await importTs("../src/lib/stationDiscovery.ts");
const { searchStations } = await importTs("../src/lib/stationSearch.ts");
const station = (id, extra = {}) => ({ id, name: id, languages: [], tags: [], countryCode: "CN", countryName: "China", province: "湖南", clicks: 0, ...extra });

test("语言别名和类型精确归类，缺失元数据不会按国别猜测", () => {
  const a = station("a", { languages: ["Mandarin", "english"], tags: [" Smooth Jazz "] });
  assert.equal(matchesFilters(a, "chinese", "jazz"), true);
  assert.equal(matchesFilters(a, "english", "news"), false);
  assert.equal(matchesFilters(station("b"), "chinese"), false);
  assert.equal(matchesFilters(station("b", { tags: ["not jazz"] }), "", "jazz"), false);
  assert.deepEqual(new Set(languageOptions([a, station("c", { languages: ["zh", "English", ""] })])), new Set(["chinese", "english"]));
});

test("随机范围限制严格，当前地区按省优先，否则按国家", () => {
  const a = station("a", { languages: ["cantonese"] });
  const b = station("b", { province: "广东" });
  const c = station("c", { countryCode: "FR", province: null });
  assert.deepEqual(randomPool([a,b,c], [c], "favorites", a), [c]);
  assert.deepEqual(randomPool([a,b,c], [], "chinese", a), [a]);
  assert.deepEqual(randomPool([a,b,c], [], "region", a), [a]);
  assert.deepEqual(randomPool([a,b,c], [], "region", { ...a, province: null }), [a,b]);
  assert.deepEqual(randomPool([a,b,c], [], "region", null), []);
});

test("随机避开当前和近期电台，耗尽可循环，单台不触发暂停", () => {
  const [a,b,c] = ["a","b","c"].map((id) => station(id));
  assert.equal(pickRandom([a,b,c], "a", ["b"], () => 0), c);
  assert.equal(pickRandom([a,b,c], "a", ["b","c"], () => 0), b);
  assert.equal(pickRandom([a], "a", [], () => 0), null);
  assert.equal(pickRandom([], null, [], () => 0), null);
});

test("先筛选再限制搜索数量，低热度匹配台不会被前 50 条挤掉", () => {
  const list = Array.from({length: 70}, (_, i) => station(`radio ${i}`, { clicks: 100-i }));
  list.push(station("radio target", { languages: ["english"], tags: ["jazz"] }));
  const result = searchStations(list.filter((s) => matchesFilters(s, "english", "jazz")), "radio");
  assert.deepEqual(result.hits.map((s) => s.id), ["radio target"]);
});

test("所有现有目录分片携带真实元数据且列位置一致", () => {
  for (const part of ["core", "rest", "catalog"]) {
    const data = JSON.parse(readFileSync(new URL(`../src/data/stations-${part}.json`, import.meta.url)));
    const offset = part === "catalog" ? 5 : 18;
    assert.deepEqual(data.fields.slice(offset), ["languages", "tags"]);
    assert.ok(data.stations.every((row) => typeof row[offset] === "string" && typeof row[offset+1] === "string"));
    assert.ok(data.stations.some((row) => row[offset] && row[offset+1]));
  }
});

test("语言选项只展示规范类别，清除众包数字、标签和重复方言写法", () => {
  const a = station("a", { languages: ["国语", "hakka", "american english", "80s", "1", "https://example.com", "português (brasil)"] });
  assert.deepEqual(new Set(languageOptions([a])), new Set(["chinese", "english", "portuguese"]));
  assert.equal(matchesFilters(a, "chinese"), true);
});
