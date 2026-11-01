import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "./tsLoader.mjs";

const { countryNameOf } = await importTs("../src/lib/countryNames.ts");

test("常见国家返回中文名，大小写不敏感", () => {
  assert.equal(countryNameOf("FR"), "法国");
  assert.equal(countryNameOf("fr"), "法国");
  assert.equal(countryNameOf("US"), "美国");
  assert.equal(countryNameOf("DE"), "德国");
});

test("港澳台用规范全称，而不是语言包里的长写法", () => {
  assert.equal(countryNameOf("HK"), "中国香港");
  assert.equal(countryNameOf("MO"), "中国澳门");
  assert.equal(countryNameOf("TW"), "中国台湾");
});

test("非法或未知代码返回空串，不把代码或「未知地区」当国名", () => {
  assert.equal(countryNameOf(""), "");
  assert.equal(countryNameOf("FRA"), "");
  assert.equal(countryNameOf("1A"), "");
  assert.equal(countryNameOf("ZZ"), "");
});

test("同一代码重复查询结果一致", () => {
  assert.equal(countryNameOf("JP"), countryNameOf("JP"));
});
