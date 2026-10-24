import { hasNativeHls } from "./capability";
import type { Station } from "./types";

/**
 * 所有播放路径的唯一出口。
 *
 * 现在原样返回：站点只收 https 流，浏览器可直接连。
 * 如果将来要做流代理，只改这一个函数，其余代码一行都不用动；
 * 这也是为什么播放器组件不许直接读 station.url。
 */
export function resolveStreamUrl(url: string): string {
  return url;
}

/** 是否需要走 hls.js：接口标记了 hls，或者地址本身是 m3u8 */
export function isHlsStream(station: Station): boolean {
  return station.hls || /\.m3u8(\?|$)/i.test(station.url);
}

/** 需要 hls.js 且浏览器没有原生支持时才动态加载它 */
export function needsHlsJs(station: Station): boolean {
  return isHlsStream(station) && !hasNativeHls();
}

/** 秒数转 00:00 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
