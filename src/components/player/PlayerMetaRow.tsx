import SleepControl from "../SleepControl";
import AlternativeStations from "./AlternativeStations";
import { flagOf, stationMeta } from "../StationRow";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

type Props = {
  station: Station;
  status: EngineStatus;
  elapsed: number;
  error: string | null;
  erroring: boolean;
  failedForAutoplay: boolean;
  canSwap: boolean;
  queue: Station[];
  notice: { from: Station; to: Station } | null;
  onRetry: () => void;
  onErrorAlternative: () => void;
  onHideStation: () => void;
  onUndoAutoSwitch: () => void;
};

/* 元数据、错误与替代台、缓冲提示共用的一行；右侧是睡眠定时。 */
export default function PlayerMetaRow({
  station,
  status,
  elapsed,
  error,
  erroring,
  failedForAutoplay,
  canSwap,
  queue,
  notice,
  onRetry,
  onErrorAlternative,
  onHideStation,
  onUndoAutoSwitch,
}: Props) {
  /*
   * 位置为估算这件事跟着台走：地图上不再有单独的卡片来交代它，
   * 播放条是唯一的名片，就由它在最末尾补一句。只到省和估算分开说。
   */
  const meta = [
    flagOf(station.countryCode),
    ...stationMeta(station),
    station.geoApprox
      ? station.geoPrecision === "province"
        ? "位置仅到省"
        : "位置为估算"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const homepage = /^https?:\/\//i.test(station.homepage ?? "") ? station.homepage : null;

  return (
    <div className="flex min-h-10 items-center justify-between gap-2 sm:px-3.5 sm:pt-1 sm:pb-2.5">
      {notice && !erroring && !failedForAutoplay ? (
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="truncate text-cold">已自动切到 {notice.to.name}</span>
          <button
            type="button"
            onClick={onUndoAutoSwitch}
            className="shrink-0 text-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
          >
            撤销
          </button>
        </div>
      ) : failedForAutoplay ? (
        <button type="button" onClick={onRetry} className="min-h-9 text-left text-[13px] text-signal">点击开始收听</button>
      ) : erroring ? (
        <div className="flex min-w-0 flex-col gap-1 text-[12px]">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-alert">{error ?? "播放失败"}</span>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 text-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            >
              重试
            </button>
            {canSwap && (
              <button
                type="button"
                onClick={onErrorAlternative}
                className="shrink-0 text-cold underline decoration-line underline-offset-2 transition-colors hover:text-ink"
              >
                换一个同城的台
              </button>
            )}
            <button
              type="button"
              onClick={onHideStation}
              className="shrink-0 text-dim underline decoration-line underline-offset-2 transition-colors hover:text-ink"
            >
              隐藏这个台
            </button>
          </div>
          {/* 错误提示 + 替代推荐 */}
          <AlternativeStations station={station} queue={queue} />
        </div>
      ) : status === "buffering" && elapsed >= 8 ? (
        // 卡了这么久，与其让用户继续盯着 BUFFERING，不如直接告诉他还能怎么办
        <p className="truncate text-[12px] text-cold">已缓冲 8 秒 · 可以换一个台</p>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <p title={meta} className="truncate text-[12px] text-muted">
            {meta}
          </p>
          {homepage && (
            <a
              href={homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[12px] text-cold transition-colors hover:text-ink"
            >
              官网
            </a>
          )}
        </div>
      )}
      <SleepControl />
    </div>
  );
}
