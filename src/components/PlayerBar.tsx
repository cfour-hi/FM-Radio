import { cn } from "../lib/cn";
import { canSetVolume } from "../lib/capability";
import { flagOf, stationMeta } from "./StationRow";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
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
        "grid h-7 w-7 shrink-0 place-items-center rounded transition-colors",
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
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-dim transition-colors hover:text-ink"
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
        className="h-1 w-[84px] cursor-pointer appearance-none rounded-full bg-line accent-signal"
      />
      <span className="num w-7 text-right text-[10px] tabular-nums text-dim">{pct}%</span>
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
        "grid h-9 w-9 place-items-center rounded-full border transition-colors",
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

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="下一个台"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M15 5.5h2v13h-2zM6 5.5v13l9-6.5z" />
      </svg>
    </button>
  );
}

/*
 * 播放条从「横贯窗口的 83px 通栏」变成「左下角一张更通透的名片」。
 *
 * 去掉了左侧封面盒（电台 favicon 经常加载失败，空盒反而碍眼），改用一条
 * 状态色细条作 now-playing 指示；标题升到 16px 并允许换行，长台名也看得全；
 * 国旗回到 meta 行首。卡片降到 /50 + 强模糊，地球能从背后透出来。
 *
 * 桌面端是「标题行 / meta 行 / 控制行（含音量滑块）」三段；移动端空间紧，
 * 回到单行贴底，操作内联在右侧、不挂音量滑块。
 *
 * 没有选台时不该占位置：一条小提示就够。
 */
export default function PlayerBar() {
  const station = usePlayer((s) => s.station);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const retry = usePlayer((s) => s.retry);

  const playing = status === "playing";
  const erroring = status === "error";

  if (!station) {
    return (
      <div
        role="region"
        aria-label="播放器"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:justify-start sm:p-0"
      >
        <p className="num rounded-full border border-line bg-base-2/18 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-dim backdrop-blur-sm">
          未选择电台 · 点光点或台名收听
        </p>
      </div>
    );
  }

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
        ? "bg-alert"
        : status === "tuning" || status === "buffering"
          ? "bg-cold"
          : status === "paused"
            ? "bg-dim"
            : "bg-line";

  return (
    <div
      role="region"
      aria-label="播放器"
      className={cn(
        "relative fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base-2/85 backdrop-blur-md",
        "sm:inset-x-auto sm:bottom-6 sm:left-6 sm:z-30 sm:w-fit sm:max-w-[min(380px,calc(100vw-3rem))] sm:rounded-[12px] sm:border sm:bg-base-2/10 sm:backdrop-blur-sm sm:shadow-2xl",
      )}
    >
      {/* now-playing 状态色细条 */}
      <span className={cn("pointer-events-none absolute left-0 top-3 bottom-3 w-[3px] rounded-full", barTone)} />

      <div className="flex items-center gap-2.5 px-3 py-2.5 sm:block sm:px-0 sm:py-0">
        <div className="min-w-0 flex-1 sm:flex sm:flex-col">
          {/* 标题行：台名放大到 16px、可换行；移动端单行截断 */}
          <div className="flex items-start gap-1.5 sm:px-3.5 sm:pt-3">
            <p
              title={station.name}
              className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink sm:text-[16px] sm:whitespace-normal sm:line-clamp-2 sm:[overflow-wrap:anywhere]"
            >
              {station.name}
            </p>
            <StatusBadge status={status} />
          </div>

          {/* meta 行：国旗在行首，已经拼进 meta 字符串 */}
          <div className="sm:px-3.5 sm:pt-1 sm:pb-2.5">
            {erroring ? (
              <div className="flex min-w-0 items-center gap-2 text-[10px]">
                <span className="truncate text-alert">{error ?? "播放失败"}</span>
                <button
                  type="button"
                  onClick={retry}
                  className="shrink-0 text-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
                >
                  重试
                </button>
              </div>
            ) : (
              <p title={meta} className="truncate text-[10px] text-muted">
                {meta}
              </p>
            )}
          </div>
        </div>

        {/* 移动端：操作内联在右侧 */}
        <div className="flex shrink-0 items-center gap-0.5 sm:hidden">
          <PlayToggle playing={playing} erroring={erroring} status={status} onToggle={toggle} />
          <NextButton onClick={() => next(1)} />
          <FavoriteButton station={station} />
          <MuteButton />
        </div>
      </div>

      {/* 桌面端：独立控制行，挂音量滑块 */}
      <div className="hidden items-center justify-end gap-1 border-t border-line/70 px-3.5 py-2 sm:flex">
        <PlayToggle playing={playing} erroring={erroring} status={status} onToggle={toggle} />
        <NextButton onClick={() => next(1)} />
        <FavoriteButton station={station} />
        <MuteButton />
        <VolumeSlider />
      </div>
    </div>
  );
}
