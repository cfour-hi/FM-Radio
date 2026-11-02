/*
 * 常见英文旧称 / 别称 → 普通话拼音或地区 token。
 *
 * pinyin-pro 生成的是 beijing / guangzhou / xianggang，但历史上更常见的
 * 写法是 peking / canton / hongkong。这里只补一小张表，查询时把别名
 * 展开成规范 token 再匹配。
 */
const ALIASES: Record<string, string> = {
  peking: "beijing",
  peiping: "beijing",
  canton: "guangzhou",
  amoy: "xiamen",
  hongkong: "xianggang",
  macau: "aomen",
  macao: "aomen",
  chungking: "chongqing",
  tientsin: "tianjin",
};

/** 只对纯 ASCII 查询生效；返回规范 token，没有别名时返回 null。 */
export function aliasFor(needle: string): string | null {
  const compact = needle.replace(/[^a-z0-9]/g, "");
  return ALIASES[compact] ?? null;
}
