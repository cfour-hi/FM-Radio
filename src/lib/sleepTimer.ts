/** 睡眠定时到期前多久开始降低音量 */
export const SLEEP_FADE_MS = 30_000;

/**
 * 算出淡出的开始延迟与时长。
 *
 * 剩余时间不足一个淡出窗口时立即开始、只淡当前剩余的那段；
 * 已经过期的截止时间返回 null（由 expiry 自己处理）。
 */
export function fadePlan(
  until: number | null,
  now = Date.now(),
  duration = SLEEP_FADE_MS,
): { delay: number; duration: number } | null {
  if (until === null || !Number.isFinite(until) || duration <= 0) return null;
  const remaining = until - now;
  if (remaining <= 0) return null;
  if (remaining <= duration) return { delay: 0, duration: remaining };
  return { delay: remaining - duration, duration };
}

/** 使用绝对截止时间，后台节流或设备休眠后检查不会重新开始倒计时。 */
export function createSleepTimer(
  expire: () => void,
  now = Date.now,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  unschedule: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let deadline: number | null = null;
  let handle: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (handle !== undefined) unschedule(handle);
    handle = undefined;
    deadline = null;
  };
  const check = () => {
    if (deadline === null) return;
    if (handle !== undefined) unschedule(handle);
    handle = undefined;
    const remaining = deadline - now();
    if (remaining <= 0) {
      deadline = null;
      expire();
    } else handle = schedule(check, Math.min(remaining, 60_000));
  };
  return {
    arm: (until: number | null) => {
      cancel();
      if (until !== null && Number.isFinite(until)) { deadline = until; check(); }
    },
    check,
    cancel,
  };
}
