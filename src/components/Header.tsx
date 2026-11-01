import { NavLink } from "react-router-dom";
import { APP_NAME, SLOGAN } from "../lib/brand";
import { cn } from "../lib/cn";
import { useMapStore } from "../store/map";
import { usePlayer } from "../store/player";

/*
 * 顶栏不再横贯整个窗口。
 *
 * 它原来是 56px 高的一条通栏，里面只有一个 logo 和一个状态词——整颗球
 * 为此少了一整条可视高度。现在收成左上角一枚小胶囊，浮在地图上，地图
 * 铺满整个视口。
 *
 * 胶囊里保留了原来那条通栏的全部信息：logo 既是「回首页」的链接，也是
 * 「回到世界」的触发（左键点一下让镜头飞回全球视角），右边的信号点和
 * On Air / Standby 说明当前是否在出声。
 *
 * 胶囊现在是两行结构：第一行是品牌（信号点 + 中文应用名「地球之声」+
 * 小号英文副标 FM Radio + 出声状态），第二行是 slogan，左对齐于应用名。
 */

export default function Header() {
  const live = usePlayer((s) => s.status === "playing");
  const flyHome = useMapStore((s) => s.flyHome);

  return (
    <header className="pointer-events-none fixed left-2 top-3 z-30 sm:left-6 sm:top-6">
      <div className="pointer-events-auto flex flex-col gap-1 rounded-[8px] border border-line/70 bg-base/55 px-2 py-2 sm:px-3 sm:py-2.5 backdrop-blur-md">
        {/* 品牌行：信号点 + 应用名 + 英文副标 + 出声状态 */}
        <div className="flex items-center gap-2">
          <NavLink
            to="/"
            onClick={flyHome}
            className="group flex min-h-7 items-center gap-1.5 sm:gap-2"
            aria-label="回到世界视角"
          >
            <span className="signal-dot" />
            <span className="flex items-baseline gap-1.5">
              <span className="text-[14px] sm:text-[15px] font-medium text-ink">{APP_NAME}</span>
              <span className="num hidden text-[10px] uppercase tracking-[0.14em] text-muted sm:inline">
                FM Radio
              </span>
            </span>
          </NavLink>

          <span
            aria-hidden
            className={cn("hidden h-1 w-1 rounded-full sm:block", live ? "bg-signal" : "bg-dim")}
          />
          <span
            className={cn(
              "num hidden text-[10px] uppercase tracking-[0.12em] sm:inline",
              live ? "text-signal" : "text-dim",
            )}
          >
            {live ? "On Air" : "Standby"}
          </span>
        </div>

        {/* slogan 行 */}
        <div className="flex items-center gap-2">
          <span aria-hidden className="hidden h-1.5 w-1.5 opacity-0 sm:block" />
          <span className="whitespace-nowrap text-[12px] tracking-[0.08em] text-muted">
            {SLOGAN}
          </span>
        </div>
      </div>
    </header>
  );
}
