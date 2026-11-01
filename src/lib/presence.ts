/*
 * 「这个面板此刻在不在」的相位机。
 *
 * 只有 closed 才摘 DOM，其余三个都挂着——因为退场要看得见，
 * 而「看得见」就意味着元素必须在场。这也正是它值得单独成文件的原因：
 * 组件里那句 `if (!open) return null` 看着像个小早退，实际上是
 * 一切进出场动画的拦路虎。
 */

export type PresencePhase = "closed" | "enter" | "open" | "closing";

/**
 * 相位推进。
 *
 * 注意 closing + open 落到 open 而不是 enter：从半路收回时如果重走入场，
 * 面板会先跳回屏外再滑进来，看起来像闪了一下。位移本身由 CSS 过渡连续插值，
 * 状态只需要告诉它「继续展开」。
 *
 * enter → open 的推进不在这里，它要等浏览器画完一帧，那是渲染时序问题
 * （见 usePresence），不是状态机问题。
 */
export function nextPhase(phase: PresencePhase, open: boolean): PresencePhase {
  if (open) return phase === "closing" || phase === "open" ? "open" : "enter";
  return phase === "closed" ? "closed" : "closing";
}

/** 元素是否还需要留在 DOM 里 */
export function isPresent(phase: PresencePhase): boolean {
  return phase !== "closed";
}
