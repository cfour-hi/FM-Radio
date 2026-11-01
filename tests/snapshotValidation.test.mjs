import assert from "node:assert/strict";
import test from "node:test";
import { checkShrink, validateSnapshot, validateStations } from "../scripts/lib/snapshot.mjs";

/** 只造校验会读的字段：id / 台名 / 流地址 / 坐标 */
function station(id, extra = {}) {
  return {
    id,
    name: `台 ${id}`,
    url: `https://example.com/${id}.mp3`,
    lat: null,
    lon: null,
    ...extra,
  };
}

const shard = (count, prefix = "s") =>
  Array.from({ length: count }, (_, i) => station(`${prefix}${i}`));

test("完整且干净的分片通过校验", () => {
  const result = validateSnapshot({
    core: shard(3, "c"),
    rest: shard(2, "r"),
    catalog: shard(1, "k"),
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("重复 id / 重复流地址 / 非 https 都会被拦下", () => {
  const first = station("a");
  const list = [
    first,
    station("a"),
    station("b", { url: first.url }),
    station("c", { url: "http://example.com/c.mp3" }),
  ];
  const { ok, errors } = validateStations(list, "core");
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("id 重复：a")));
  assert.ok(errors.some((e) => e.includes("流地址重复")));
  assert.ok(errors.some((e) => e.includes("不是 https")));
});

test("坐标越界或只填一半会被拦下", () => {
  const list = [
    station("a", { lat: 91, lon: 0 }),
    station("b", { lat: 0, lon: 181 }),
    station("c", { lat: 30, lon: null }),
    station("d", { lat: Number.NaN, lon: 10 }),
  ];
  const { ok, errors } = validateStations(list, "core");
  assert.equal(ok, false);
  assert.equal(errors.filter((e) => e.includes("坐标越界")).length, 3);
  assert.ok(errors.some((e) => e.includes("只有纬度没有经度")));
});

test("同一个 id 出现在两份分片里会被拦下", () => {
  const { ok, errors } = validateSnapshot({
    core: [station("same")],
    rest: [station("same")],
    catalog: [station("other")],
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("id 跨分片重复：same")));
});

test("空分片不是合法快照", () => {
  const { ok, errors } = validateSnapshot({
    core: [station("a")],
    rest: [],
    catalog: [station("b")],
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("rest 为空")));
});

test("数量掉超过 15% 判为异常，正常波动放行", () => {
  const previous = { core: 1000, rest: 2000, catalog: 3000 };
  assert.equal(checkShrink(previous, { core: 900, rest: 1900, catalog: 2900 }).ok, true);
  const shrunk = checkShrink(previous, { core: 700, rest: 2000, catalog: 3000 });
  assert.equal(shrunk.ok, false);
  assert.ok(shrunk.errors.some((e) => e.includes("core 从 1000 降到 700")));
});

test("首次生成没有上一版时不触发缩水检查", () => {
  assert.equal(checkShrink({ core: 0, rest: 0, catalog: 0 }, { core: 1, rest: 0, catalog: 0 }).ok, true);
  assert.equal(checkShrink(undefined, { core: 1, rest: 0, catalog: 0 }).ok, true);
});
