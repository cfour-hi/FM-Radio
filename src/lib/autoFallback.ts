import { pickAlternatives } from "./stationAlternatives";
import { isPlayable } from "./stationFilter";
import type { EngineErrorKind } from "../player/errors";
import type { Station } from "./types";

/** 一次失败事件里最多连续自动换几次；防止整条队列都是坏台时无限跳。 */
export const AUTO_SWITCH_LIMIT = 3;

/*
 * 需要用户点一下才能继续的错误，自动换台没有意义：
 * 自动播放拦截要用户手势；格式不支持换台也可能同样不支持；HLS 解码器
 * 加载失败通常是网络问题，直接换台反而藏起了可重试的错误。
 */
const NO_AUTO_SWITCH: ReadonlySet<EngineErrorKind> = new Set([
  "autoplay-blocked",
  "unsupported",
  "hls-decoder",
  "aborted",
]);

export function shouldAutoSwitch(kind: EngineErrorKind | null): boolean {
  return kind !== null && !NO_AUTO_SWITCH.has(kind);
}

/**
 * 从当前队列里挑下一个能播的台。
 *
 * 复用「同城 → 同省 → 同国」的排序，再排除本次事件里已经试过的、本地
 * 隐藏的、以及格式或证书有问题的台。
 */
export function pickFallback(
  current: Station,
  queue: Station[],
  tried: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): Station | null {
  const pool = queue.filter(
    (station) => station.id !== current.id && !tried.has(station.id),
  );
  const [pick] = pickAlternatives(
    current,
    pool,
    (station) => isPlayable(station, hidden),
    1,
  );
  return pick ?? null;
}
