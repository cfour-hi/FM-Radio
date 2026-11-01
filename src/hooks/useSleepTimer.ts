import { useEffect } from "react";
import { createSleepTimer } from "../lib/sleepTimer";
import { usePlayer } from "../store/player";

export function useSleepTimer() {
  const until = usePlayer((s) => s.sleepUntil);
  useEffect(() => {
    const timer = createSleepTimer(() => usePlayer.getState().expireSleep());
    timer.arm(until);
    window.addEventListener("pageshow", timer.check);
    window.addEventListener("focus", timer.check);
    document.addEventListener("visibilitychange", timer.check);
    return () => {
      timer.cancel();
      window.removeEventListener("pageshow", timer.check);
      window.removeEventListener("focus", timer.check);
      document.removeEventListener("visibilitychange", timer.check);
    };
  }, [until]);
}
