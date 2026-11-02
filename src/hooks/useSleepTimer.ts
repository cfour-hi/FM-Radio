import { useEffect } from "react";
import { canSetVolume } from "../lib/capability";
import { createSleepTimer, fadePlan } from "../lib/sleepTimer";
import { engine } from "../player/engine";
import { usePlayer } from "../store/player";

export function useSleepTimer() {
  const until = usePlayer((s) => s.sleepUntil);

  useEffect(() => {
    const timer = createSleepTimer(() => usePlayer.getState().expireSleep());
    timer.arm(until);

    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let fadeStarted = false;

    /*
     * 已经开始淡出就不要重排：fadeOut 会从 1 重新开始，音量会先跳回去。
     * 切换定时或卸载时由 cleanup 取消。
     */
    const scheduleFade = () => {
      if (fadeStarted) return;
      if (fadeTimer !== undefined) {
        clearTimeout(fadeTimer);
        fadeTimer = undefined;
      }
      if (!canSetVolume()) return;
      const plan = fadePlan(until);
      if (!plan) return;

      const start = () => {
        fadeStarted = true;
        engine.fadeOut(plan.duration);
      };
      if (plan.delay <= 0) start();
      else {
        fadeTimer = setTimeout(() => {
          fadeTimer = undefined;
          start();
        }, plan.delay);
      }
    };

    scheduleFade();

    const check = () => {
      timer.check();
      scheduleFade();
    };
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);

    return () => {
      timer.cancel();
      if (fadeTimer !== undefined) clearTimeout(fadeTimer);
      engine.cancelFade();
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [until]);
}
