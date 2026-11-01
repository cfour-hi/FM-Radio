import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { pickAlternatives, hasAlternative } = await importTs("../src/lib/stationAlternatives.ts");

/** 只造 pickAlternatives 会读的字段 */
function station(id, extra = {}) {
  return { id, clicks: 0, province: null, city: null, countryCode: "", geo: null, ...extra };
}

/** 纬度每 1 度约 111 公里，用它精确造出想要的远近 */
const at = (lat, lon = 0) => ({ lat, lon });

test("中国台按同城 → 同省 → 同国排序", () => {
  const current = station("me", { province: "湖南", city: "长沙", countryCode: "CN", geo: at(28) });
  const pool = [
    current,
    station("country", { province: "广东", countryCode: "CN", geo: at(28.01) }), // 更近，但只是同国
    station("province", { province: "湖南", city: "岳阳", countryCode: "CN", geo: at(28.4) }),
    station("city", { province: "湖南", city: "长沙", countryCode: "CN", geo: at(28.02) }),
  ];
  assert.deepEqual(pickAlternatives(current, pool).map((s) => s.id), ["city", "province", "country"]);
});

test("同一档内按距离，再按热度", () => {
  const current = station("me", { province: "湖南", city: "长沙", countryCode: "CN", geo: at(28) });
  const pool = [
    station("far", { province: "湖南", city: "长沙", countryCode: "CN", geo: at(29), clicks: 999 }),
    station("near", { province: "湖南", city: "长沙", countryCode: "CN", geo: at(28.1), clicks: 0 }),
  ];
  assert.deepEqual(pickAlternatives(current, pool).map((s) => s.id), ["near", "far"]);
});

test("境外台只在本国内找，按 300 / 1500 公里分档", () => {
  const paris = at(48.85, 2.35);
  const current = station("me", { countryCode: "FR", geo: paris });
  const pool = [
    current,
    station("other-country", { countryCode: "DE", geo: at(48.9, 2.4) }), // 更近但跨国
    station("near", { countryCode: "FR", geo: at(48.9, 2.4) }), // 约 6 公里
    station("region", { countryCode: "FR", geo: at(45.76, 4.83) }), // 约 390 公里
    station("far", { countryCode: "FR", geo: at(43.6, 1.44) }), // 约 590 公里
  ];
  assert.deepEqual(pickAlternatives(current, pool).map((s) => s.id), ["near", "region", "far"]);
});

test("候选比 limit 多时只取前几个", () => {
  const current = station("me", { province: "湖南", countryCode: "CN" });
  const pool = Array.from({ length: 10 }, (_, i) => station(`s${i}`, { province: "湖南", countryCode: "CN", clicks: i }));
  assert.equal(pickAlternatives(current, pool).length, 5, "默认 5 个");
  assert.equal(pickAlternatives(current, pool, undefined, 2).length, 2);
  assert.deepEqual(pickAlternatives(current, pool, undefined, 2).map((s) => s.id), ["s9", "s8"], "热度高的在前");
});

test("accept 用来剔除同样播不了的台", () => {
  const current = station("me", { province: "湖南", countryCode: "CN" });
  const pool = [station("bad", { province: "湖南", countryCode: "CN", clicks: 9 }), station("good", { province: "湖南", countryCode: "CN", clicks: 1 })];
  const only = (s) => s.id !== "bad";
  assert.deepEqual(pickAlternatives(current, pool, only).map((s) => s.id), ["good"]);
  assert.equal(hasAlternative(current, pool, only), true);
  assert.equal(hasAlternative(current, pool, () => false), false);
});

test("没有坐标也不会算出 NaN，仍按热度排", () => {
  const current = station("me", { countryCode: "FR" });
  const pool = [station("a", { countryCode: "FR", clicks: 1 }), station("b", { countryCode: "FR", clicks: 5 })];
  assert.deepEqual(pickAlternatives(current, pool).map((s) => s.id), ["b", "a"]);
});

test("自己在候选里也不会被选成替代", () => {
  const current = station("me", { province: "湖南", countryCode: "CN" });
  assert.deepEqual(pickAlternatives(current, [current]), []);
  assert.equal(hasAlternative(current, [current]), false);
});

test("没有任何同省同国的台时，hasAlternative 说没有", () => {
  const current = station("me", { province: "湖南", countryCode: "CN" });
  const pool = [station("x", { countryCode: "JP" }), station("y", { countryCode: "US" })];
  assert.equal(hasAlternative(current, pool), false);
  assert.deepEqual(pickAlternatives(current, pool), []);
});

test("不改变传入的候选顺序", () => {
  const current = station("me", { province: "湖南", countryCode: "CN" });
  const pool = [
    station("a", { province: "湖南", countryCode: "CN", clicks: 1 }),
    station("b", { province: "广东", countryCode: "CN", clicks: 9 }),
  ];
  const before = pool.slice();
  pickAlternatives(current, pool);
  assert.deepEqual(pool, before);
});
