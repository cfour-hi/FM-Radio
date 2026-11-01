import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { readStationId, buildStationUrl, STATION_PARAM } = await importTs("../src/lib/deepLink.ts");

test("从查询串里认出电台 id", () => {
  assert.equal(readStationId("?s=abc"), "abc");
  assert.equal(readStationId("?a=1&s=6f2c-11ef"), "6f2c-11ef");
  assert.equal(readStationId("?s=%20abc%20"), "abc", "两侧空白要去掉");
  assert.equal(readStationId("?foo=bar"), null);
  assert.equal(readStationId("?s="), null);
  assert.equal(readStationId(""), null);
});

test("可疑的 id 一律当作没有", () => {
  assert.equal(readStationId("?s=a%20b"), null, "空格不是 id 的一部分");
  assert.equal(readStationId("?s=<script>"), null);
  assert.equal(readStationId(`?s=${"a".repeat(65)}`), null, "超过 64 位不认");
  assert.equal(readStationId(`?s=${"a".repeat(64)}`), "a".repeat(64), "刚好 64 位可以");
});

test("分享链接保留发布平台的参数，只摘掉调试用的 guide", () => {
  const url = buildStationUrl("abc", "https://earth-radio.app.workbuddy.host/?sharecode=HPHH533VO7&guide=1#top");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("sharecode"), "HPHH533VO7", "删了别人打不开");
  assert.equal(parsed.searchParams.get("guide"), null, "调试参数不该跟着分享出去");
  assert.equal(parsed.searchParams.get(STATION_PARAM), "abc");
  assert.equal(parsed.hash, "", "锚点扔掉");
});

test("已有同一个参数时是替换，不是追加", () => {
  const url = buildStationUrl("new-id", "https://example.com/?s=old-id");
  assert.equal(new URL(url).searchParams.getAll(STATION_PARAM).length, 1);
  assert.equal(readStationId(new URL(url).search), "new-id");
});

test("生成的链接能被自己读回来", () => {
  for (const id of ["abc", "6f2c1ee0-8a3f-4a6e-9d5e-2f8c1ee08a3f", "A_b-9"]) {
    assert.equal(readStationId(new URL(buildStationUrl(id, "https://example.com/")).search), id);
  }
});
