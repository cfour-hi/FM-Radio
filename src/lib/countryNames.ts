import { regionLabel } from "./cnEnrichment";

/*
 * 国家代码 → 中文国名。
 *
 * 用 Intl.DisplayNames 而不是维护一张几十条的中英对照表：语言包跟着浏览器
 * 走，永远不会漏国家，也不会写错。运行环境不支持时返回空串，界面退化为
 * 英文国名与国家代码。
 *
 * 港澳台不走 Intl：语言包给的是「中国香港特别行政区」「台湾」这类写法，
 * 既啰嗦又不合规范。这三地的中文名由 regionLabel 统一给出，和数据里的
 * 省名是同一套。
 *
 * 结果按代码缓存：catalog 有 2 万多个台，同一国家会被反复问到。
 */
const CN_SPECIAL: Record<string, string> = { HK: "香港", MO: "澳门", TW: "台湾" };

let displayNames: Intl.DisplayNames | null | undefined;
const cache = new Map<string, string>();

export function countryNameOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";

  const upper = code.toUpperCase();
  const cached = cache.get(upper);
  if (cached !== undefined) return cached;

  const special = CN_SPECIAL[upper];
  let name = "";

  if (special) {
    name = regionLabel(special);
  } else {
    if (displayNames === undefined) {
      try {
        displayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
      } catch {
        displayNames = null;
      }
    }
    try {
      const resolved = displayNames?.of(upper);
      // 未知代码可能原样返回代码，也可能给「未知地区」，两种都不算国名
      if (resolved && resolved.toUpperCase() !== upper && resolved !== "未知地区") {
        name = resolved;
      }
    } catch {
      name = "";
    }
  }

  cache.set(upper, name);
  return name;
}
