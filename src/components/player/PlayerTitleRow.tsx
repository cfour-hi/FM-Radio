import { cn } from "../../lib/cn";
import { StatusBadge, TuningInfo } from "./StatusDisplay";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

type Props = {
  station: Station;
  status: EngineStatus;
  failedForAutoplay: boolean;
  onLocate: () => void;
  onCollapse: () => void;
};

/* 台名 + 状态徽章 + 移动端收起键；调谐期间在下面补一张详情卡。 */
export default function PlayerTitleRow({
  station,
  status,
  failedForAutoplay,
  onLocate,
  onCollapse,
}: Props) {
  const favicon = station.favicon?.startsWith("https://") ? station.favicon : null;

  return (
    <>
      {/* 标题行：台名放大到 16px、可换行；移动端单行截断。点台名飞回它在地球上的位置 */}
      <div className="flex items-center gap-1.5 sm:px-3.5 sm:pt-3">
        {favicon && (
          <img
            src={favicon}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-4 w-4 shrink-0 rounded-[3px] object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
        <button
          type="button"
          onClick={onLocate}
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
        {failedForAutoplay
          ? <span className="shrink-0 text-[12px] text-muted">待播放</span>
          : <StatusBadge status={status} />}
        <button
          type="button"
          onClick={onCollapse}
          aria-label="收起播放器"
          aria-expanded={true}
          aria-controls="player-body"
          className="h-11 shrink-0 px-2 text-[12px] text-muted sm:hidden"
        >
          收起
        </button>
      </div>

      {/* 调谐期间显示电台详细信息 */}
      {(status === "tuning" || status === "buffering") && <TuningInfo station={station} />}
    </>
  );
}
