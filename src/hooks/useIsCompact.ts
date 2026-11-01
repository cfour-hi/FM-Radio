import { useSyncExternalStore } from "react";

/*
 * 是不是窄屏。
 *
 * 全项目的布局断点只有 sm(640px) 一个，但 CSS 管不到的判断（要不要挂手势）
 * 必须在 JS 里问一次。用 useSyncExternalStore 而不是 useState + useEffect：
 * 后者会在首帧渲染出一个「桌面」再立刻纠正，动画和手势都会闪一下。
 */

const QUERY = "(max-width: 639.98px)";

let cached: MediaQueryList | null = null;

function list(): MediaQueryList | null {
  if (typeof matchMedia !== "function") return null;
  cached ??= matchMedia(QUERY);
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const mql = list();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return list()?.matches ?? false;
}

export function useIsCompact(): boolean {
  // 服务端/测试环境一律当桌面，那里本来也没有布局
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
