import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { AUTO_SWITCH_LIMIT, pickFallback, shouldAutoSwitch } =
  await importTs("../src/lib/autoFallback.ts");

const station = (id, extra = {}) => ({
  id,
  name: `台 ${id}`,
  url: `https://example.com/${id}.mp3`,
  codec: "MP3",
  sslError: false,
  province: "湖南",
  city: "长沙",
  countryCode: "CN",
  clicks: 10,
  geo: null,
  ...extra,
});

test("自动播放被拦截、格式不支持等不自动换台", () => {
  for (const kind of ["autoplay-blocked", "unsupported", "hls-decoder", "aborted"]) {
    assert.equal(shouldAutoSwitch(kind), false, kind);
  }
  for (const kind of ["network", "decode", "connect-timeout", "buffer-timeout", "stream-ended", "unknown"]) {
    assert.equal(shouldAutoSwitch(kind), true, kind);
  }
  assert.equal(shouldAutoSwitch(null), false);
});

test("优先同城，跳过已试过与隐藏的台", () => {
  const current = station("me", { city: "长沙" });
  const sameCity = station("same-city", { city: "长沙" });
  const sameProvince = station("same-province", { city: "岳阳" });
  const queue = [current, sameCity, sameProvince];

  assert.equal(pickFallback(current, queue, new Set(), new Set())?.id, "same-city");
  assert.equal(pickFallback(current, queue, new Set(), new Set(["same-city"]))?.id, "same-province");
  assert.equal(pickFallback(current, queue, new Set(["same-city"]), new Set())?.id, "same-province");
});

test("没有可换的台时返回 null", () => {
  const current = station("me");
  assert.equal(pickFallback(current, [current], new Set(), new Set()), null);
  assert.equal(AUTO_SWITCH_LIMIT, 3);
});
