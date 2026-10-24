import { memo, type CSSProperties } from "react";
import { checkSupport, cautionOf } from "../lib/capability";
import { regionLabel } from "../lib/cnEnrichment";
import type { Station } from "../lib/types";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";

/** 行高固定，虚拟滚动才能只靠乘法定位 */
export const ROW_HEIGHT = 60;

/** 把国家代码转成旗帜；非两位字母就原样返回 */
export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  const chars = [...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...chars);
}

/**
 * 国家名和首个标签经常重复（France / french / france），去重后再拼。
 *
 * 有省市归属的中国台，第一段换成「湖南 · 长沙」，不写国家——
 * 「China」对一个想找本省电台的人没有任何信息量，而省市才是他要的那一栏。
 */
export function stationMeta(station: Station): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const region = regionOf(station);
  const parts = [region || station.countryName || station.countryCode, station.languages[0], station.tags[0]];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * 归属的展示串。
 *
 * 只知道省的时候不写城市：那个城市值是给落点用的省会，写出来就是在
 * 假装我们知道得比实际更多。
 */
export function regionOf(station: Station): string {
  if (!station.province) return "";
  const province = regionLabel(station.province);
  if (station.geoPrecision === "province") return province;
  if (!station.city || station.city === station.province) return province;
  return `${province} · ${station.city}`;
}

type Props = {
  station: Station;
  index: number;
  /** 当前列表，交给播放器决定「下一个台」是谁 */
  queue: Station[];
  style?: CSSProperties | undefined;
  /** 抽屉里的紧凑版：去掉序号与码率列，行高更矮 */
  compact?: boolean;
  /** 播放前先回调（地图用：有坐标就飞过去） */
  onPick?: (station: Station) => void;
  /** meta 行末尾追加的提示，如「无法定位」 */
  note?: string;
};

function PlayingBars() {
  return (
    <span aria-hidden className="eq" data-idle="false">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function StationRow({ station, index, queue, style, compact = false, onPick, note }: Props) {
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const isCurrent = usePlayer((s) => s.station?.id === station.id);
  const currentStatus = usePlayer((s) => (s.station?.id === station.id ? s.status : null));

  const favorite = useLibrary((s) => s.favoriteIds.has(station.id));
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);

  const support = checkSupport(station);
  const caution = cautionOf(station);
  const playing = isCurrent && currentStatus === "playing";
  const busy = isCurrent && (currentStatus === "tuning" || currentStatus === "buffering");

  const meta = stationMeta(station);
  // 虚拟滚动时由外层给定绝对定位；普通列表（收藏页）按文档流排列
  const virtual = style !== undefined;

  const activate = () => {
    onPick?.(station);
    if (isCurrent) {
      toggle();
      return;
    }
    play(station, queue);
  };

  return (
    <li
      style={style}
      className={`${virtual ? "absolute inset-x-0 top-0" : "relative"} flex ${compact ? "h-[52px]" : "h-[60px]"} items-center border-b border-line-soft`}
      data-row={station.id}
    >
      {/* 整行是一个按钮，收藏是它的兄弟节点：按钮不能嵌套按钮 */}
      <button
        type="button"
        onClick={activate}
        aria-label={`${playing ? "暂停" : "播放"} ${station.name}`}
        className={`group flex h-full min-w-0 flex-1 items-center gap-4 px-2 text-left transition-colors ${
          isCurrent ? "bg-surface/60" : "hover:bg-surface/70"
        }`}
      >
        {!compact && (
          <span
            className={`num flex w-7 shrink-0 justify-end text-[11px] ${
              isCurrent ? "text-signal" : "text-dim"
            }`}
          >
            {isCurrent ? <span className="signal-dot" /> : String(index + 1).padStart(2, "0")}
          </span>
        )}

        <span className="w-5 shrink-0 text-center text-[15px] leading-none">
          {flagOf(station.countryCode)}
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] ${isCurrent ? "text-signal" : "text-ink"}`}>
            {station.name}
          </span>
          <span className="block truncate text-[11px] text-dim">
            {meta.join(" · ")}
            {caution && <span className="text-cold"> · {caution}</span>}
            {note && <span className="text-cold"> · {note}</span>}
          </span>
        </span>

        {!support.ok && (
          <span className="num hidden shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[9px] uppercase tracking-[0.12em] text-dim sm:block">
            播不了
          </span>
        )}

        {!compact && (
          <span className="hidden shrink-0 items-center gap-3 sm:flex">
            <span className="num text-[11px] text-dim">{station.codec}</span>
            <span className="num w-10 text-right text-[11px] tabular-nums text-muted">
              {station.bitrate > 0 ? `${station.bitrate}k` : "—"}
            </span>
          </span>
        )}

        <span className="grid h-8 w-8 shrink-0 place-items-center text-muted">
          {busy ? (
            <span className="tuning-ring" aria-hidden />
          ) : playing ? (
            <PlayingBars />
          ) : (
            <span
              className={`grid h-8 w-8 place-items-center rounded-full border transition-opacity ${
                isCurrent
                  ? "border-signal/40 text-signal opacity-100"
                  : "border-line text-dim opacity-45 group-hover:opacity-100"
              }`}
            >
              <svg viewBox="0 0 24 24" className="ml-0.5 h-3 w-3" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void toggleFavorite(station)}
        aria-label={favorite ? "取消收藏" : "收藏"}
        aria-pressed={favorite}
        className={`mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
          favorite ? "text-signal" : "text-dim hover:text-muted"
        }`}
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
    </li>
  );
}

export default memo(StationRow);
