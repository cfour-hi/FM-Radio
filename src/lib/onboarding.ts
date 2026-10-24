/*
 * 首访引导的持久化。
 *
 * 只存一个「看过」标记：1 = 已看过。读写都可能被隐私模式拦住，
 * 拦住了就当作没看过（每次整页刷新会再出现一次），不影响任何功能。
 *
 * 键名沿用现有前缀风格（fm-radio.volume / fm-radio.lastStation），
 * 带 .v1 便于以后换文案重新展示。
 */

const GUIDE_KEY = "fm-radio.onboarding.v1";
const GUIDE_PARAM = "guide";

export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_KEY, "1");
  } catch {
    /* 隐私模式写不进去：下次仍会提示，可接受 */
  }
}

/**
 * 唯一判定入口：`?guide=1` 优先，否则看标记。
 *
 * `?guide=1` 不读标记、不清标记、不改 URL——保留参数才能刷新重看。
 * 因此它是「分享/调试用强制重看」，而不是「清除已读」。
 */
export function isGuideForced(search: string = currentSearch()): boolean {
  return new URLSearchParams(search).get(GUIDE_PARAM) === "1";
}

export function shouldShowGuide(search: string = currentSearch()): boolean {
  if (isGuideForced(search)) return true;
  return !hasSeenGuide();
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
