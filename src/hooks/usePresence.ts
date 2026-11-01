import { useEffect, useState } from "react";
import { MOTION_MS, prefersReducedMotion } from "../lib/motion";
import { nextPhase, type PresencePhase } from "../lib/presence";

/**
 * 让一个面板能「滑出去」而不是「瞬间消失」。
 *
 * 组件只关心 open 这个布尔值，相位由这里推。用相位而不是再加一个
 * visible 状态，是因为退场那 180ms 里有个中间态：元素在场、内容还在、
 * 但已经不吃点击了——三件事得同时成立，一个布尔值说不清。
 */
export function usePresence(open: boolean, duration = MOTION_MS): PresencePhase {
  const [phase, setPhase] = useState<PresencePhase>(open ? "enter" : "closed");

  useEffect(() => {
    setPhase((current) => nextPhase(current, open));
  }, [open]);

  useEffect(() => {
    if (phase === "enter") {
      /*
       * 两帧，不是一帧。
       *
       * 第一帧让浏览器真的把 translateX(100%) 这一版画出去，第二帧再改成 0，
       * 过渡才有起点。同一帧里改两次等于没动——元素会直接出现在终点。
       */
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setPhase("open"));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    if (phase !== "closing") return;
    /*
     * 用定时器收尾，不用 transitionend。
     *
     * 一是减少动态效果时我们把 transition 关掉了，transitionend 永远不来，
     * 面板会卡在半开状态；二是面板里那些 transition-colors 会把事件冒上来，
     * 得额外比对 target 和 propertyName；三是关闭途中又打开时，可能收到
     * 被中断那次过渡的事件。定时器只需 clearTimeout，语义干净。
     */
    const ms = prefersReducedMotion() ? 0 : duration;
    const timer = window.setTimeout(() => setPhase("closed"), ms);
    return () => window.clearTimeout(timer);
  }, [phase, duration]);

  return phase;
}
