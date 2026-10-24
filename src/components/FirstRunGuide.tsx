import { useEffect, useRef } from "react";
import { markGuideSeen } from "../lib/onboarding";

/*
 * 首访欢迎卡。
 *
 * 用原生 <dialog> + showModal()：进入 top layer，天然压过 Header/PlayerBar，
 * 自带焦点陷阱与 Esc，且 useGlobalKeys 里已有 dialog[open] 的让路判断。
 *
 * 组件没有 open prop：父层用 {guideOpen && <FirstRunGuide/>} 条件渲染，
 * 挂载即「要显示」，卸载即「已结束」。
 *
 * 四个关闭出口（开始探索 / 随机点亮 / Esc / 点遮罩）全部收敛到 finish()，
 * 标记在 finish() 里同步写入——不能只靠 onClose，因为 close() 后立刻卸载
 * 会让 close 事件到不了 React 的根监听器。
 */

export type GuideAction = "start" | "random";

type Props = {
  /** 关闭后回调：父层负责收起引导，random 时顺手播放一个随机台 */
  onFinish: (action: GuideAction) => void;
};

const STEPS: { index: string; text: string }[] = [
  { index: "01", text: "点光点或台名，听见那个地方" },
  { index: "02", text: "拖动地球，换个方向找台" },
  { index: "03", text: "右上角的骰子，随机点亮一个台" },
];

export default function FirstRunGuide({ onFinish }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const done = useRef(false);
  const downOnScrim = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // StrictMode 下 effect 会跑两遍：第二遍 open 已为 true，再 showModal 会抛错
    if (!dialog.open) dialog.showModal();
    // 不依赖 autoFocus（与 dialog 自身的 focus fixup 可能各抢一次），显式聚焦最确定
    primaryRef.current?.focus();
  }, []);

  function finish(action: GuideAction) {
    if (done.current) return;
    done.current = true;
    markGuideSeen();
    if (dialogRef.current?.open) dialogRef.current.close();
    onFinish(action);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="guide-title"
      aria-describedby="guide-desc"
      onCancel={(event) => {
        // 拦下浏览器直接关闭，统一走 finish（Esc 视同「开始探索」，不随机）
        event.preventDefault();
        finish("start");
      }}
      onClose={() => {
        // 兜底：任何非我方发起的关闭也落标记，避免状态卡死
        if (!done.current) finish("start");
      }}
      onPointerDown={(event) => {
        // 记录按下是否落在遮罩上，区分「点遮罩」与「卡内拖选后松手在遮罩上」
        downOnScrim.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // ::backdrop 的点击目标是 dialog 本身；卡内点击目标是子元素
        if (downOnScrim.current && event.target === event.currentTarget) finish("start");
      }}
      className="guide-dialog m-auto w-[min(92vw,360px)] bg-transparent p-0 text-ink"
    >
      <div className="glass-panel rounded-[10px] px-5 py-5 sm:px-6 sm:py-6">
        <p className="num text-[10px] uppercase tracking-[0.18em] text-cold">
          首次接收 · First Contact
        </p>

        <h2 id="guide-title" className="mt-2 text-[18px] font-medium text-ink">
          地球已经在播音
        </h2>

        <p id="guide-desc" className="mt-2 text-[12.5px] leading-relaxed text-muted">
          一座会发声的地球。每个光点，都是此刻某个地方正在说话的电台。
        </p>

        <ul className="mt-4 space-y-2.5">
          {STEPS.map((step) => (
            <li key={step.index} className="flex items-baseline gap-3 text-[12.5px] text-muted">
              <span className="num shrink-0 text-[11px] tabular-nums text-dim">{step.index}</span>
              <span className="text-ink">{step.text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={primaryRef}
            type="button"
            onClick={() => finish("start")}
            className="h-11 rounded-[8px] border border-signal/40 bg-signal-soft text-[13px] font-medium text-signal transition-colors hover:border-signal/70"
          >
            开始探索
          </button>
          <button
            type="button"
            onClick={() => finish("random")}
            className="h-11 rounded-[8px] border border-line text-[13px] text-muted transition-colors hover:text-ink"
          >
            随机点亮一个台
          </button>
        </div>

        <p className="num mt-3 text-center text-[10px] uppercase tracking-[0.16em] text-dim">
          ESC 关闭
        </p>
      </div>
    </dialog>
  );
}
