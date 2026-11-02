import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { canSetVolume } from "../../lib/capability";
import { buildStationUrl } from "../../lib/deepLink";
import { usePlayer } from "../../store/player";
import { useLibrary } from "../../store/library";
import { useMapStore } from "../../store/map";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

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
export function FavoriteButton({ station }: { station: Station }) {
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
export function CopyLinkButton({ station }: { station: Station }) {
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
 * 分享这个台。
 *
 * 手机上优先调系统分享面板；不支持时才退回剪贴板。和复制链接一样，
 * 链接会保留当前 URL 的 sharecode / 其它参数。
 */
export function ShareButton({ station }: { station: Station }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    const url = buildStationUrl(station.id);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: station.name, text: `正在收听 ${station.name}`, url });
        return;
      } catch (error) {
        // 用户取消不算失败；其它错误继续尝试剪贴板
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
    } catch {
      /* 没有剪贴板权限时静默失败 */
    }
  };

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={copied ? "已复制链接" : "分享这个台"}
      title={copied ? "已复制" : "分享"}
      className={cn(
        "grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded transition-colors",
        copied ? "text-signal" : "text-dim hover:text-muted",
      )}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 15V4" />
          <path d="m8 8 4-4 4 4" />
          <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
      )}
    </button>
  );
}

/* 静音键。iOS 上 canSetVolume 为 false，音量写不进去，连静音也一起隐藏。 */
export function MuteButton() {
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
export function VolumeSlider() {
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

/* 播放/下一台是移动端单行与桌面端控制行共用的操作，抽出来避免两份 JSX。 */
export function PlayToggle({
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

export function PreviousButton() {
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

export function NextButton({ onClick }: { onClick: () => void }) {
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
