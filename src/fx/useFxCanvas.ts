import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion";

/*
 * 粒子特效共用的 canvas 基建。
 *
 * 每个特效只写两样东西：怎么按新尺寸重建粒子（build），每一帧怎么画（draw）。
 * 循环、像素密度、尺寸监听、页面隐藏暂停、reduced-motion 降级都在这里，
 * 四个特效不必各抄一遍，也不会出现某个特效忘掉暂停之类的疏漏。
 *
 * 为什么不是 three.js：本项目的重依赖（maplibre、hls.js）全部走懒加载，
 * 粒子场景只是地球的另一种「壁纸」，为一个旋转星系背 150KB gzip 不值。
 * Canvas 2D 画两三千个圆绰绰有余。
 */

export type FxFrame = {
  ctx: CanvasRenderingContext2D;
  /** CSS 像素（不是物理像素），draw 里所有坐标都以它为准 */
  width: number;
  height: number;
  /** 距上一帧的秒数，页面隐藏恢复后不会跳变 */
  dt: number;
  /** 场景启动以来的累计秒数 */
  time: number;
};

export type FxCanvasCallbacks = {
  /** 尺寸变化或首次挂载：按 width/height 重建粒子。参数是 CSS 像素 */
  build: (width: number, height: number) => void;
  /** 每一帧。reduced-motion 时只被调用一次（dt=0） */
  draw: (frame: FxFrame) => void;
};

export function useFxCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  callbacks: FxCanvasCallbacks,
) {
  /*
   * 回调经 ref 转发，循环本身只启停一次：特效组件每帧要读的播放状态
   * （正在播哪个台）随时会变，不该因为它的变化就把整个 RAF 拆掉重装。
   */
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    let time = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      // DPR 封顶 2：4K 屏上再高也只是多花一倍填充率，肉眼分不出来
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cbRef.current.build(width, height);
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      cbRef.current.draw({ ctx, width, height, dt, time });
      raf = requestAnimationFrame(frame);
    };

    resize();
    if (prefersReducedMotion()) {
      // 静帧：星系还是那颗星系，只是不转
      cbRef.current.draw({ ctx, width, height, dt: 0, time: 0 });
    } else {
      raf = requestAnimationFrame(frame);
    }

    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (Math.round(rect.width) === width && Math.round(rect.height) === height) return;
      resize();
    });
    observer.observe(canvas);

    // 后台标签页别空转：回来时 last=0，第一帧 dt 是 0，不会跳帧
    const onVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && !prefersReducedMotion()) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [canvasRef]);
}
