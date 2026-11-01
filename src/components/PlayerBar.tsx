import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SleepControl from "./SleepControl";
import { cn } from "../lib/cn";
import { canSetVolume, cautionOf, checkSupport } from "../lib/capability";
import { buildStationUrl } from "../lib/deepLink";
import { decideCollapse, decideRestore } from "../lib/swipeGesture";
import { hasAlternative, pickAlternatives } from "../lib/stationAlternatives";
import { getErrorHint } from "../player/errors";
import { useDragGesture } from "../hooks/useDragGesture";
import { useIsCompact } from "../hooks/useIsCompact";
import { flagOf, stationMeta } from "./StationRow";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useMapStore } from "../store/map";
import type { EngineStatus } from "../player/engine";
import type { Station } from "../lib/types";

function StatusBadge({ status }: { status: EngineStatus }) {
  const weakSignal = usePlayer((s) => s.status === "tuning" && s.elapsed >= 4);
  if (status === "idle") return null;

  const label =
    status === "playing"
      ? "LIVE"
      : status === "tuning"
        ? weakSignal
          ? "WEAK SIGNAL"
          : "TUNING"
        : status === "buffering"
          ? "BUFFERING"
          : status === "paused"
            ? "PAUSED"
            : "ERROR";

  const tone =
    status === "error"
      ? "text-alert border-alert/30"
      : status === "playing"
        ? "text-signal border-signal/30"
        : status === "paused"
          ? "text-dim border-line"
          : "text-cold border-cold/30";

  return (
    <span
      className={cn(
        "num mt-px shrink-0 rounded-[3px] border px-1.5 py-px text-[9px] uppercase tracking-[0.16em]",
        tone,
      )}
    >
      {label}
    </span>
  );
}

/**
 * 调谐期间显示电台详细信息，减少等待焦虑。
 */
function TuningInfo({ station }: { station: Station }) {
  const meta = stationMeta(station);
  const caution = cautionOf(station);
  
  return (
    <div className="mt-1.5 rounded-[6px] bg-surface/50 px-2 py-1.5 sm:hidden">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="shrink-0">{flagOf(station.countryCode)}</span>
        <span className="truncate">{meta.slice(1).join(" · ")}</span>
        {caution && <span className="shrink-0 text-cold">· {caution}</span>}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-dim">
        <span>{station.codec}</span>
        <span>{station.bitrate > 0 ? `${station.bitrate}k` : "—"}</span>
        <span className="tuning-ring-inline" aria-hidden />
      </div>
    </div>
  );
}

function PlayIcon({ name }: { name: "play" | "pause" | "retry" }) {
  if (name === "pause") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <rect x="7" y="5" width="3.2" height="14" rx="1" />
        <rect x="13.8" y="5" width="3.2" height="14" rx="1" />
      </svg>
    );
  }
  if (name === "retry") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M19 12a7 7 0 1 1-2.1-5" />
        <path d="M19 4v4h-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/*
 * 收藏键。
 *
 * 地图上的预览卡片在台开始播之后就消失了，收藏不能跟着消失——
 * 它是「对这个台长线兴趣」的操作，理应常驻在正在播的这张名片上。
 */
function FavoriteButton({ station }: { station: Station }) {
  const favoriteIds = useLibrary((s) => s.favoriteIds);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const favorite = favoriteIds.has(station.id);

  return (
    <button
      type="button"
      onClick={() => void toggleFavorite(station)}
      aria-label={favorite ? "取消收藏" : "收藏"}
      aria-pressed={favorite}
      className={cn(
        "grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded transition-colors",
        favorite ? "text-signal" : "text-dim hover:text-muted",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill={favorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 4h12v16l-6-4-6 4z" />
      </svg>
    </button>
  );
}

/*
 * 复制这个台的链接。
 *
 * 分享单个台是这类产品最自然的一次传播：对方点开就直接听到同一个台，
 * 而不是先看一张地球自己找。非安全上下文没有 clipboard，这时整个按钮
 * 不渲染——留一个点了没反应的键比没有更糟。
 *
 * 只在桌面控制行出现：移动端那一行已经有四个键，再挤一个会把台名压没。
 */
function CopyLinkButton({ station }: { station: Station }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (typeof navigator === "undefined" || !navigator.clipboard) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildStationUrl(station.id));
      setCopied(true);
    } catch {
      /* 权限被拒：静默失败，不弹东西打断收听 */
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "已复制链接" : "复制这个台的链接"}
      title={copied ? "已复制" : "复制链接"}
      className={cn(
        "grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded transition-colors",
        copied ? "text-signal" : "text-dim hover:text-muted",
      )}
    >
      {copied ? (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.2 6.6" />
          <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

/*
 * 静音键。iOS 上 canSetVolume 为 false，音量写不进去，连静音也一起隐藏。
 */
function MuteButton() {
  const muted = usePlayer((s) => s.muted);
  const volume = usePlayer((s) => s.volume);
  const toggleMute = usePlayer((s) => s.toggleMute);

  if (!canSetVolume()) return null;

  return (
    <button
      type="button"
      onClick={toggleMute}
      aria-label={muted ? "取消静音" : "静音"}
      aria-pressed={muted || volume === 0}
      className="grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded text-dim transition-colors hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M4 9.5v5h3l4 3.5V6L7 9.5H4z" />
        {muted || volume === 0 ? (
          <path d="m16 9.5 4 5M20 9.5l-4 5" />
        ) : (
          <path d="M15.5 9a4 4 0 0 1 0 6" />
        )}
      </svg>
    </button>
  );
}

/*
 * 音量滑块。只在桌面端出现（canSetVolume 为 false 时整组不渲染），
 * 手机上没有系统级音量条，交给系统键更自然。
 */
function VolumeSlider() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);

  if (!canSetVolume()) return null;

  const pct = Math.round((muted ? 0 : volume) * 100);

  return (
    <div className="flex shrink-0 items-center gap-1.5 pl-1">
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        aria-label="音量"
        className="h-1 w-[64px] cursor-pointer appearance-none rounded-full bg-line accent-signal"
      />
      <span className="num w-7 text-right text-[12px] tabular-nums text-dim">{pct}%</span>
    </div>
  );
}

/*
 * 播放/下一台是移动端单行与桌面端控制行共用的操作，抽出来避免两份 JSX。
 */
function PlayToggle({
  playing,
  erroring,
  status,
  onToggle,
}: {
  playing: boolean;
  erroring: boolean;
  status: EngineStatus;
  onToggle: () => void;
}) {
  const icon = erroring ? "retry" : playing ? "pause" : "play";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={playing ? "暂停" : erroring ? "重试" : "播放"}
      className={cn(
        "grid h-11 w-11 sm:h-9 sm:w-9 place-items-center rounded-full border transition-colors",
        playing || erroring
          ? "border-signal/40 bg-signal-soft text-signal hover:border-signal/70"
          : "border-line bg-surface text-ink hover:border-dim",
      )}
    >
      {status === "tuning" || status === "buffering" ? (
        <span className="tuning-ring" aria-hidden />
      ) : (
        <PlayIcon name={icon} />
      )}
    </button>
  );
}

function PreviousButton() {
  const available = usePlayer((s) => s.history.length > 0);
  const name = usePlayer((s) => s.history.at(-1)?.station.name);
  return (
    <button type="button" disabled={!available} aria-label={name ? `上一站：${name}` : "上一站"} title={name ? `上一站：${name}` : "还没有上一站"}
      onClick={() => {
        const station = usePlayer.getState().previous();
        if (station?.geo) useMapStore.getState().focusStation(station.geo);
      }} className="grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded text-muted disabled:opacity-30">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m10 5-7 7 7 7M3 12h12a5 5 0 0 1 0 10" /></svg>
    </button>
  );
}

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="下一个台"
      className="grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M15 5.5h2v13h-2zM6 5.5v13l9-6.5z" />
      </svg>
    </button>
  );
}

/**
 * 错误态下显示替代电台推荐。
 * 展示 1-3 个同城/同省的电台，点击直接切换。
 */
function AlternativeStations({ station, queue }: { station: Station | null; queue: Station[] }) {
  const play = usePlayer((s) => s.play);
  const errorKind = usePlayer((s) => s.errorKind);
  const error = usePlayer((s) => s.error);
  
  if (!station) return null;
  
  const alternatives = useMemo(() => {
    const alts = pickAlternatives(
      station, 
      queue, 
      (s) => checkSupport(s).ok && !s.sslError,
      3
    );
    return alts;
  }, [station, queue]);
  
  if (alternatives.length === 0) {
    const hint = errorKind ? getErrorHint(errorKind, error ?? undefined) : null;
    if (hint) {
      return <p className="truncate text-[11px] text-dim">{hint}</p>;
    }
    return null;
  }
  
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-dim">试试这些：</span>
      {alternatives.map((alt) => (
        <button
          key={alt.id}
          type="button"
          onClick={() => play(alt, queue)}
          className="truncate rounded-[3px] bg-surface px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-ink"
          title={alt.name}
        >
          {alt.name}
        </button>
      ))}
    </div>
  );
}

/** 迷你播放器保留台名、定时和播放控制；与 CSS 收起位移保持一致。 */
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

  const meta = [
    flagOf(station.countryCode),
    ...stationMeta(station),
    /*
     * 位置为估算这件事跟着台走：地图上不再有单独的卡片来交代它，
     * 播放条是唯一的名片，就由它在最末尾补一句。只到省和估算分开说。
     */
    station.geoApprox
      ? station.geoPrecision === "province"
        ? "位置仅到省"
        : "位置为估算"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
        <div className="mini-player absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-3 sm:hidden">
          <button type="button" onClick={() => setCollapsed(false)} aria-label="展开播放器" aria-expanded={false} aria-controls="player-body" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left">
            <span className="w-full truncate text-[14px] text-ink">{station.name}</span>
            <SleepControl compact />
          </button>
          <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={toggle} />
          <button type="button" onClick={() => setCollapsed(false)} aria-label="展开播放器控制" className="h-11 px-2 text-[12px] text-muted">展开</button>
        </div>
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
          {/* 标题行：台名放大到 16px、可换行；移动端单行截断。点台名飞回它在地球上的位置 */}
          <div className="flex items-start gap-1.5 sm:px-3.5 sm:pt-3">
            <button
              type="button"
              onClick={() => station.geo && focusStation(station.geo)}
              disabled={!station.geo}
              title={station.geo ? "在地图上定位" : station.name}
              aria-label={station.geo ? `在地图上定位 ${station.name}` : station.name}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-[15px] font-medium text-ink sm:text-[16px] sm:whitespace-normal sm:line-clamp-2 sm:[overflow-wrap:anywhere]",
                station.geo ? "transition-colors hover:text-signal" : "cursor-default",
              )}
            >
              {station.name}
            </button>
            {failedForAutoplay ? <span className="shrink-0 text-[12px] text-muted">待播放</span> : <StatusBadge status={status} />}
            <button type="button" onClick={() => setCollapsed(true)} aria-label="收起播放器" aria-expanded={true} aria-controls="player-body" className="-mt-2 h-11 shrink-0 px-2 text-[12px] text-muted sm:hidden">收起</button>
          </div>
          
          {/* 调谐期间显示电台详细信息 */}
          {(status === "tuning" || status === "buffering") && <TuningInfo station={station} />}

          {/* meta 行：国旗在行首，已经拼进 meta 字符串 */}
          <div className="flex min-h-10 items-center justify-between gap-2 sm:px-3.5 sm:pt-1 sm:pb-2.5">
            {failedForAutoplay ? (
              <button type="button" onClick={retry} className="min-h-9 text-left text-[13px] text-signal">点击开始收听</button>
            ) : erroring ? (
              <div className="flex min-w-0 flex-col gap-1 text-[12px]">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-alert">{error ?? "播放失败"}</span>
                  <button
                    type="button"
                    onClick={retry}
                    className="shrink-0 text-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
                  >
                    重试
                  </button>
                  {canSwap && (
                    <button
                      type="button"
                      onClick={errorAlternative}
                      className="shrink-0 text-cold underline decoration-line underline-offset-2 transition-colors hover:text-ink"
                    >
                      换一个同城的台
                    </button>
                  )}
                </div>
                {/* 错误提示 + 替代推荐 */}
                <AlternativeStations station={station} queue={queue} />
              </div>
            ) : status === "buffering" && elapsed >= 8 ? (
              // 卡了这么久，与其让用户继续盯着 BUFFERING，不如直接告诉他还能怎么办
              <p className="truncate text-[12px] text-cold">已缓冲 8 秒 · 可以换一个台</p>
            ) : (
              <p title={meta} className="truncate text-[12px] text-muted">
                {meta}
              </p>
            )}
            <SleepControl />
          </div>
        </div>

        {/* 移动端：紧凑控制行，给台名留出完整宽度 */}
        <div className="mt-1 flex items-center justify-between gap-1 sm:hidden">
          <PreviousButton />
          <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={toggle} />
          <NextButton onClick={() => next(1)} />
          <FavoriteButton station={station} />
          <MuteButton />
        </div>
        
        {/* 移动端快捷操作栏：单手模式，大屏手机友好 */}
        <div className="mt-2 flex items-center justify-center gap-3 border-t border-line/50 pt-2 pb-1 sm:hidden">
          <button
            type="button"
            onClick={() => previous()}
            disabled={!hasPrevious}
            aria-label="上一台"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted transition-colors disabled:opacity-30 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="m10 5-7 7 7 7M3 12h12a5 5 0 0 1 0 10" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "暂停" : "播放"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-signal text-base transition-transform active:scale-95"
          >
            {status === "tuning" || status === "buffering" ? (
              <span className="tuning-ring" aria-hidden />
            ) : playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <rect x="7" y="5" width="3.2" height="14" rx="1" />
                <rect x="13.8" y="5" width="3.2" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 ml-0.5" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => next(1)}
            aria-label="下一台"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted transition-colors active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M15 5.5h2v13h-2zM6 5.5v13l9-6.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 桌面端：独立控制行，挂音量滑块 */}
      <div className="hidden flex-wrap items-center justify-between gap-1 border-t border-line/70 px-3.5 py-2 sm:flex">
        <PreviousButton />
        <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={toggle} />
        <NextButton onClick={() => next(1)} />
        <FavoriteButton station={station} />
        <CopyLinkButton station={station} />
        <MuteButton />
        <VolumeSlider />
      </div>
    </div>
  );
}
