import assert from "node:assert/strict";
import test from "node:test";

import { createPinyinTools } from "../scripts/lib/pinyin.mjs";

/*
 * 地名罗马化不依赖 pinyin-pro，来自仓库里的 cn-places / 省别名；
 * 台名全拼才会用到 pinyin-pro，没装时 nameTokens 返回空数组。
 */
const tools = await createPinyinTools();

test("省与城市的罗马化别名都会写进 place token", () => {
  const hunan = tools.placeTokens({ province: "湖南", city: "长沙", place: null });
  assert.ok(hunan.includes("hunan"), hunan.join(","));
  assert.ok(hunan.includes("changsha"), hunan.join(","));

  const hainan = tools.placeTokens({ province: "海南", city: "海口", place: null });
  assert.ok(hainan.includes("hainan"), hainan.join(","));
  assert.ok(hainan.includes("haikou"), hainan.join(","));
});

test("地名 token 只保留规范罗马化与拼音，不塞入全部历史转写", () => {
  const beijing = tools.placeTokens({ province: "北京", city: "北京", place: null });
  assert.ok(beijing.includes("beijing"), beijing.join(","));
  assert.ok(beijing.length < 20, `token 太多：${beijing.join(",")}`);
});

test("没有地名的台返回空数组", () => {
  assert.deepEqual(tools.placeTokens({ province: null, city: null, place: null }), []);
});

test("中文台名生成全拼与首字母", () => {
  const tokens = tools.nameTokens("北京新闻广播");
  assert.ok(tokens.includes("beijingxinwenguangbo"), tokens.join(","));
  assert.ok(tokens.includes("bjxwgb"), tokens.join(","));
});

test("英文台名不生成拼音 token", () => {
  assert.deepEqual(tools.nameTokens("BBC Radio 4"), []);
});
