/*
 * 动效的两个共用常量。
 *
 * 这两样东西原来只藏在 WorldMap 里（相机飞行要不要动画）。抽屉和播放条
 * 也要动起来之后，同一句话就有了三处副本，改一次要记三个地方。
 */

/** 抽屉滑入滑出、播放条收起的位移时长。与 index.css 里的 180ms ease-out 是同一个数 */
export const MOTION_MS = 180;

/**
 * 系统是否要求减少动态效果。
 *
 * 环境里没有 matchMedia 时按「不减少」处理——那是测试或 SSR 环境，
 * 不是用户真的表达了这个偏好，不该替他做决定。
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
