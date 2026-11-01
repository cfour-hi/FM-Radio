import { useCallback, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { clampOffset, lockAxis, swipeVelocity, type DragSample } from "../lib/swipeGesture";

/*
 * 拖拽手势。抽屉横着用，播放条竖着用，所以只写一份。
 *
 * 三条不写在别处的约定，都是会真实咬人的：
 *
 * 1. 不调 setPointerCapture。显式捕获会把 pointerup 的 target 重定向到根元素，
 *    于是 click 落到根上而不是那一行 <button>——鼠标拖一次之后，列表就再也
 *    点不中台了。触摸本来就有隐式捕获，鼠标端用 window 监听兜住已经够。
 * 2. 每帧只写一个 CSS 变量，不 setState。抽屉里有几十行列表，逐帧重渲会掉帧。
 * 3. 拖过 8px 之后要吃掉紧随其后的 click，否则「右滑关闭」会顺手播一个台。
 */

/** 采样只留最近这些，够算 90ms 窗口，也不会让数组无限长 */
const SAMPLE_LIMIT = 24;
/** 位移超过它才算「真的拖了」，此前的抖动不该吃掉点击 */
const DRAG_ARM_PX = 8;
/** 抑制窗口。用时间窗而不是计数：浏览器可能补发延迟 click，也可能补发两次 */
const SUPPRESS_MS = 350;

export type DragSettle = { delta: number; velocity: number };

type Options = {
  /** 关掉时一个事件都不挂（桌面抽屉、未选台时的播放条） */
  enabled: boolean;
  axis: "x" | "y";
  /** CSS 变量名，跟手位移由它承载 */
  varName: string;
  /** 可拖动的最大偏移，按下时按元素尺寸现算 */
  getMax: (el: HTMLElement) => number;
  onSettle: (info: DragSettle) => void;
  onDragChange?: (dragging: boolean) => void;
};

type Session = {
  el: HTMLElement;
  startX: number;
  startY: number;
  base: number;
  max: number;
  samples: DragSample[];
  axis: "none" | "x" | "y";
  moved: number;
};

/** 从计算样式里读当前位移，不把 CSS 常量搬到 JS——收起态从哪儿起算由样式说话 */
function readOffset(el: HTMLElement, axis: "x" | "y"): number {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return 0;
  const match = /matrix(?:3d)?\(([^)]+)\)/.exec(transform);
  if (!match) return 0;
  const parts = match[1]!.split(",").map(Number);
  const value = axis === "x" ? parts[4] : parts[5];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useDragGesture(options: Options) {
  const latest = useRef(options);
  latest.current = options;

  const session = useRef<Session | null>(null);
  const suppressUntil = useRef(0);

  /*
   * 监听器之间互相引用（move 要能 detach，detach 要知道挂了谁），
   * 用一个可赋值的对象先立好再填，比让几个 useCallback 绕成环清楚。
   */
  const listeners = useMemo(() => {
    const api: {
      move: (event: PointerEvent) => void;
      up: (event: PointerEvent) => void;
      cancel: (event: PointerEvent) => void;
      detach: () => void;
    } = {
      move: () => {},
      up: () => {},
      cancel: () => {},
      detach: () => {},
    };

    api.detach = () => {
      window.removeEventListener("pointermove", api.move);
      window.removeEventListener("pointerup", api.up);
      window.removeEventListener("pointercancel", api.cancel);
    };

    /** 交出手势：摘监听、清会话，位移留给调用方决定怎么收 */
    const teardown = () => {
      const current = session.current;
      if (!current) return null;
      session.current = null;
      api.detach();
      latest.current.onDragChange?.(false);
      return current;
    };

    /** 放弃手势（方向锁走了另一边）：立刻回弹，不结算 */
    const abort = () => {
      const current = teardown();
      if (!current) return;
      current.el.style.transition = "";
      current.el.style.removeProperty(latest.current.varName);
    };

    api.move = (event) => {
      const current = session.current;
      if (!current || !event.isPrimary) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (current.axis === "none") {
        const locked = lockAxis(dx, dy);
        if (locked === "none") return;
        // 锁到另一个轴：这是滚动或别的手势，整段放弃，把事件还给浏览器
        if (locked !== latest.current.axis) {
          abort();
          return;
        }
        current.axis = locked;
        current.el.style.transition = "none";
        latest.current.onDragChange?.(true);
      }

      const delta = latest.current.axis === "x" ? dx : dy;
      current.moved = Math.abs(delta);
      current.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
      if (current.samples.length > SAMPLE_LIMIT) current.samples.shift();

      const offset = clampOffset(current.base + delta, current.max);
      current.el.style.setProperty(latest.current.varName, `${offset}px`);
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      const current = session.current;
      if (!current) return;

      const moved = latest.current.axis === "x"
        ? event.clientX - current.startX
        : event.clientY - current.startY;
      const { vx, vy } = swipeVelocity(current.samples);
      const velocity = latest.current.axis === "x" ? vx : vy;
      const dragged = current.axis !== "none" && current.moved > DRAG_ARM_PX;
      const locked = current.axis;

      const el = current.el;
      teardown();
      // 先恢复过渡，位移还留在原位——收尾动画从手指放开处接着走
      el.style.transition = "";
      if (dragged) suppressUntil.current = performance.now() + SUPPRESS_MS;
      // 浏览器接管了这段手势（纵向滚动起来、iOS 边缘返回、来电）→ 只回弹
      if (!cancelled && locked !== "none") latest.current.onSettle({ delta: moved, velocity });

      /*
       * 摘内联位移必须等 React 把新状态刷进 DOM 之后，所以放进 rAF。
       *
       * 摘早了浏览器会分两帧各算一次样式：先弹回旧位置、下一帧再滑向新位置，
       * 看起来就是「松手闪一下」。rAF 回调跑在 React 的微任务刷新之后、本帧
       * 样式重算之前，两条路正好并进同一次 recalc。
       */
      const name = latest.current.varName;
      requestAnimationFrame(() => el.style.removeProperty(name));
    };

    api.up = (event) => finish(event, false);
    api.cancel = (event) => finish(event, true);

    return api;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const settings = latest.current;
      if (!settings.enabled) return;
      if (!event.isPrimary || event.button !== 0) return;
      // 搜索框里横向拖动是在选词，不是在拖面板
      if (isTextEntry(event.target)) return;
      if (session.current) return;

      const el = event.currentTarget;
      session.current = {
        el,
        startX: event.clientX,
        startY: event.clientY,
        base: readOffset(el, settings.axis),
        max: settings.getMax(el),
        samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
        axis: "none",
        moved: 0,
      };
      window.addEventListener("pointermove", listeners.move, { passive: true });
      window.addEventListener("pointerup", listeners.up);
      window.addEventListener("pointercancel", listeners.cancel);
    },
    [listeners],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (performance.now() >= suppressUntil.current) return;
    suppressUntil.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { onPointerDown, onClickCapture };
}
