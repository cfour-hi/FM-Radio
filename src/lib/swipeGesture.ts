/*
 * 滑动手势的判定，全是纯函数。
 *
 * 抽出来只有一个理由：这个项目没有 DOM 测试（所有测试都跑在裸 Node 上），
 * 手感逻辑一旦写进 hook 就再也没法回归。阈值、方向锁、甩动速度这些东西
 * 恰恰是最容易改坏、又最难靠肉眼发现的部分。
 */

export type DragAxis = "none" | "x" | "y";
export type DragSample = { x: number; y: number; t: number };

/** 手指落下的前几像素是抖动，不足以说明意图 */
export const AXIS_LOCK_PX = 8;
/** 想靠「甩」而不是「拖到位」来触发时，至少要移动这么远 */
export const FLICK_MIN_PX = 24;
/** 甩动速度门槛，px/ms。0.4 ≈ 每秒 400px */
export const FLICK_VELOCITY = 0.4;
/** 只取松手前这一小段的样本算速度 */
export const VELOCITY_WINDOW_MS = 90;

export type DismissTuning = { minDistance: number; ratio: number };

/**
 * 两个控件的尺度差一个量级，阈值不能共用一个数。
 *
 * 抽屉满宽 390，56px 只是「轻轻一拨」；播放条收起时能拖的行程只有三十几像素，
 * 同一个 56px 在那里等于「必须整条拖走」，永远达不到——那个手势就成了摆设。
 */
export const DISMISS: { drawer: DismissTuning; bar: DismissTuning } = {
  drawer: { minDistance: 56, ratio: 0.24 },
  bar: { minDistance: 20, ratio: 0.3 },
};

/**
 * 方向锁。
 *
 * 超过阈值之后整段手势只认一个轴，中途改判会让面板先横移再变回纵向滚动，
 * 那比「手滑没关掉」难受得多。平手（|dx| === |dy|）判给纵向：用户更可能是
 * 想滚列表，而不是想关面板。
 */
export function lockAxis(dx: number, dy: number, threshold = AXIS_LOCK_PX): DragAxis {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "none";
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return "none";
  return ax > ay ? "x" : "y";
}

/**
 * 松手速度。
 *
 * 只取尾段：全程平均会把「慢慢拖一大段再猛一甩」算成慢速，用户会觉得甩不动。
 *
 * 任何异常输入都返回 0，绝不返回 NaN——NaN 会让后面所有阈值比较失效，
 * 面板就成了「永远关不掉」。时间戳非递增（重复或倒退）也一样。
 */
export function swipeVelocity(
  samples: readonly DragSample[],
  windowMs = VELOCITY_WINDOW_MS,
): { vx: number; vy: number } {
  const zero = { vx: 0, vy: 0 };
  if (samples.length < 2) return zero;

  const last = samples[samples.length - 1]!;
  if (!Number.isFinite(last.t)) return zero;

  /*
   * 找窗口起点：样本按时间升序，第一个落进窗口的就是它。
   *
   * 全都落在窗口外时退回倒数第二个而不是直接放弃——手指停住 100ms 再松手
   * 是常态，这时如果只拿 last 跟自己比，Δt = 0，速度永远是 0，甩动就失效了。
   * 宁可多算一点时间，也要给出一个真实的平均速度。
   */
  let startIndex = samples.length - 2;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    if (!Number.isFinite(sample.t)) return zero;
    if (last.t - sample.t <= windowMs) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === samples.length - 1) startIndex = samples.length - 2;
  const first = samples[startIndex]!;

  const dt = last.t - first.t;
  if (!(dt > 0)) return zero;

  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return zero;
  return { vx, vy };
}

type DismissInput = {
  /** 沿关闭方向的位移；decideRestore 传恢复方向（负） */
  distance: number;
  /** 沿同一方向的速度，符号与 distance 一致 */
  velocity: number;
  /** 可拖动的总行程，用来按比例定阈值 */
  size: number;
  minDistance?: number;
  ratio?: number;
};

function decide(
  input: DismissInput,
  sign: 1 | -1,
  fallback: DismissTuning,
): boolean {
  const { distance, velocity, size } = input;
  if (!Number.isFinite(distance) || !Number.isFinite(velocity) || !Number.isFinite(size)) {
    return false;
  }
  // 反方向的手势一律不算
  const travel = distance * sign;
  if (travel <= 0) return false;

  const speed = velocity * sign;
  const minDistance = input.minDistance ?? fallback.minDistance;
  const ratio = input.ratio ?? fallback.ratio;
  const threshold = Math.max(minDistance, Math.max(0, size) * ratio);

  if (travel >= threshold) return true;
  // 没拖到位，但甩得够快也算——短促的滑动本来就不该要求拖满
  return travel >= FLICK_MIN_PX && speed >= FLICK_VELOCITY;
}

/** 抽屉：右滑关闭（距离为正、速度为正在此判定） */
export function decideDismiss(input: DismissInput): boolean {
  return decide(input, 1, DISMISS.drawer);
}

/**
 * 播放条：下拉收起。
 *
 * 和 decideDismiss 的差别只有阈值档位，但档位必须分开命名——两台控件的
 * 行程差着一个量级，共用一个数的时候总有一边拖不动。
 */
export function decideCollapse(input: DismissInput): boolean {
  return decide(input, 1, DISMISS.bar);
}

/** 播放条：收起态上滑展开（距离为负、速度为负在此判定） */
export function decideRestore(input: DismissInput): boolean {
  return decide(input, -1, DISMISS.bar);
}

/** 位移夹紧。尺寸为 0 或入参不是有限数时一律回 0，不让脏值漏进 style */
export function clampOffset(offset: number, max: number): number {
  if (!Number.isFinite(offset)) return 0;
  const upper = Number.isFinite(max) ? Math.max(0, max) : 0;
  return Math.min(upper, Math.max(0, offset));
}
