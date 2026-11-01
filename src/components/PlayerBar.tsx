import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { checkSupport } from "../lib/capability";
import { decideCollapse, decideRestore } from "../lib/swipeGesture";
import { hasAlternative } from "../lib/stationAlternatives";
import { useDragGesture } from "../hooks/useDragGesture";
import { useIsCompact } from "../hooks/useIsCompact";
import { usePlayer } from "../store/player";
import { useMapStore } from "../store/map";
import { DesktopControls, MobileControls } from "./player/PlayerControls";
import MiniPlayer from "./player/MiniPlayer";
import PlayerMetaRow from "./player/PlayerMetaRow";
import PlayerTitleRow from "./player/PlayerTitleRow";

/*
 * 迷你播放器保留台名、定时和播放控制；与 CSS 收起位移保持一致。
 * 这个高度既用于拖拽行程，也用于「播放条挡住的底部高度」。
 */
const HANDLE_H = 56;

/**
 * 从展开位拖到收起位要走多远。
 *
 * 与 index.css 里 `calc(100% - 56px - env(safe-area-inset-bottom))` 是同一个
 * 式子：百分比按元素自身高度（含 padding）解析，所以行程就是「总高 - 把手 -
 * 安全区」。两边各写一遍是有意的——CSS 负责静止位置，JS 负责夹紧拖拽范围，
 * 但必须同源，改一个就要改另一个。
 */
function barTravel(el: HTMLElement): number {
  const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  return Math.max(0, el.offsetHeight - HANDLE_H - pad);
}

/** 桌面浮卡、手机底部播放器；收起时保留核心收听操作。 */
export default function PlayerBar() {
  const station = usePlayer((s) => s.station);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const errorKind = usePlayer((s) => s.errorKind);
  const elapsed = usePlayer((s) => s.elapsed);
  const queue = usePlayer((s) => s.queue);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const previous = usePlayer((s) => s.previous);
  const retry = usePlayer((s) => s.retry);
  const errorAlternative = usePlayer((s) => s.errorAlternative);
  const focusStation = useMapStore((s) => s.focusStation);

  const playing = status === "playing" || status === "tuning" || status === "buffering";
  const erroring = status === "error";
  const hasPrevious = usePlayer((s) => s.history.length > 0);

  /*
   * 有没有可替换的台。
   *
   * 只在失败态扫队列，而且用的是「找到第一个就返回」的版本——这里只需要
   * 决定那个键显示不显示，不必把队列整个排一遍。
   */
  const canSwap = useMemo(() => {
    if (!station || !erroring) return false;
    return hasAlternative(station, queue, (s) => checkSupport(s).ok && !s.sslError);
  }, [station, erroring, queue]);

  // 自动播放被拦不是「这个台坏了」，重试同一个台没意义，得让用户点一下
  const failedForAutoplay = errorKind === "autoplay-blocked";

  /*
   * 移动端的收起状态。
   *
   * 只此一份，不持久化：刷新后会恢复上次电台，那时用户要的是「看见在放什么」，
   * 而不是继续把它藏起来。换台同理——选台是明确的「给我看」。
   */
  const compact = useIsCompact();
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(false);
  }, [station?.id]);

  useEffect(() => {
    if (compact) return;
    setCollapsed(false);
    // 从窄屏切回来时可能残留手势写下的内联位移，不清掉桌面端会被它顶着
    rootRef.current?.style.removeProperty("--bar-y");
  }, [compact]);

  /*
   * 把「底部被播放器占掉多高」告诉全页面。
   *
   * 写在 documentElement 上而不是 .map-shell 上：播放条和地图是兄弟节点，
   * 自定义属性只沿 DOM 向下继承，兄弟之间不继承。地图的版权条、抽屉列表的
   * 底部内边距、HUD 角标都靠它避让。
   *
   * 语义不是「播放条高度」而是「挡住的底部高度」：没选台是 0，收起态只露出
   * 把手加安全区。所以不能只量 offsetHeight。
   */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) {
      document.documentElement.style.setProperty("--player-bar-h", "0px");
      return;
    }
    const sync = () => {
      /*
       * 桌面上这个数恒为 0。
       *
       * 桌面播放条是左下角一张浮卡，页面没有为它留位置，右边的版权条和
       * 抽屉也不需要避让。让变量在桌面归零，下面所有「calc(var() + X)」
       * 的消费方就不必各写一遍媒体查询。
       */
      if (!compact) {
        document.documentElement.style.setProperty("--player-bar-h", "0px");
        return;
      }
      // 安全区的 padding 就是 env() 解出来的 px，直接量它比在 JS 里重写一遍 env() 可靠
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const covered = collapsed ? HANDLE_H + pad : el.offsetHeight;
      document.documentElement.style.setProperty("--player-bar-h", `${covered}px`);
    };
    sync();
    // 字体放大、旋转、安全区变化都会改高度，量一次不够
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--player-bar-h");
    };
  }, [station, collapsed, compact]);

  /*
   * 竖向下拉收起、上滑展开。
   *
   * 拖拽只写 --bar-y，位移跟手但不重渲；松手才按距离/速度判定落点。
   * 不用点击切换是因为这条窄带压在 home indicator 上，只有 28px，
   * 手指在那儿的落点误差太大——滑动没有「必须点中」的问题。
   */
  const drag = useDragGesture({
    enabled: compact && Boolean(station),
    axis: "y",
    varName: "--bar-y",
    getMax: barTravel,
    onSettle: ({ delta, velocity }) => {
      const el = rootRef.current;
      if (!el) return;
      const size = barTravel(el);
      if (collapsed) {
        if (decideRestore({ distance: delta, velocity, size })) setCollapsed(false);
        return;
      }
      if (decideCollapse({ distance: delta, velocity, size })) setCollapsed(true);
    },
    onDragChange: setDragging,
  });

  if (!station) {
    return (
      <div
        role="region"
        aria-label="播放器"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:justify-start sm:p-0"
      >
        <p className="num rounded-full border border-line bg-base-2/18 px-3 py-1.5 text-[12px] uppercase tracking-[0.14em] text-dim backdrop-blur-sm">
          未选择电台 · 点光点或台名收听
        </p>
      </div>
    );
  }

  /*
   * 读屏播报。
   *
   * 状态徽章是一块只有视觉的英文小字，读屏用户不会主动去读；连接中、
   * 已暂停、尤其是「播放失败」这些变化必须能在不移动焦点的情况下听到。
   * 文案只在状态变化时变，aria-live 不会重复朗读。
   */
  const liveMessage =
    status === "tuning"
      ? `正在连接 ${station.name}`
      : status === "buffering"
        ? `正在缓冲 ${station.name}`
        : status === "playing"
          ? `正在播放 ${station.name}`
          : status === "paused"
            ? `已暂停 ${station.name}`
            : status === "error"
              ? failedForAutoplay
                ? "浏览器拦截了播放，点击播放键开始收听"
                : `${station.name} 播放失败：${error ?? "未知原因"}`
              : "";

  const barTone =
    status === "playing"
      ? "bg-signal"
      : status === "error"
        ? failedForAutoplay ? "bg-dim" : "bg-alert"
        : status === "tuning" || status === "buffering"
          ? "bg-cold"
          : status === "paused"
            ? "bg-dim"
            : "bg-line";

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="播放器"
      data-collapsed={collapsed ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
      className={cn(
        // pb 是安全区：四个按钮不能压在 home indicator 上。桌面 env() = 0，等于没加
        "player-bar relative fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base-2/85 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)]",
        "sm:inset-x-auto sm:bottom-6 sm:left-6 sm:z-30 sm:w-fit sm:max-w-[min(380px,calc(100vw-3rem))] sm:rounded-[12px] sm:border sm:bg-base-2/85 sm:backdrop-blur-sm sm:shadow-2xl",
      )}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </p>

      {collapsed && (
        <MiniPlayer
          station={station}
          status={status}
          playing={playing}
          erroring={erroring}
          failedForAutoplay={failedForAutoplay}
          onToggle={toggle}
          onExpand={() => setCollapsed(false)}
        />
      )}

      {/* now-playing 状态色细条 */}
      <span className={cn("pointer-events-none absolute left-0 top-3 bottom-3 w-[3px] rounded-full", barTone)} />

      <div
        id="player-body"
        inert={collapsed || undefined}
        aria-hidden={collapsed || undefined}
        className="px-3 py-2.5 sm:px-0 sm:py-0"
      >
        <div className="min-w-0 flex-1 sm:flex sm:flex-col">
          <PlayerTitleRow
            station={station}
            status={status}
            failedForAutoplay={failedForAutoplay}
            onLocate={() => station.geo && focusStation(station.geo)}
            onCollapse={() => setCollapsed(true)}
          />

          <PlayerMetaRow
            station={station}
            status={status}
            elapsed={elapsed}
            error={error}
            erroring={erroring}
            failedForAutoplay={failedForAutoplay}
            canSwap={canSwap}
            queue={queue}
            onRetry={retry}
            onErrorAlternative={errorAlternative}
          />
        </div>

        <MobileControls
          station={station}
          status={status}
          playing={playing}
          erroring={erroring}
          failedForAutoplay={failedForAutoplay}
          hasPrevious={hasPrevious}
          onToggle={toggle}
          onNext={() => next(1)}
          onPrevious={() => previous()}
        />
      </div>

      <DesktopControls
        station={station}
        status={status}
        playing={playing}
        erroring={erroring}
        failedForAutoplay={failedForAutoplay}
        onToggle={toggle}
        onNext={() => next(1)}
      />
    </div>
  );
}
