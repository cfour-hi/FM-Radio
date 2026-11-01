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
