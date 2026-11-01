import SleepControl from "../SleepControl";
import { PlayToggle } from "./PlayerButtons";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

type Props = {
  station: Station;
  status: EngineStatus;
  playing: boolean;
  erroring: boolean;
  failedForAutoplay: boolean;
  onToggle: () => void;
  onExpand: () => void;
};

/* 移动端收起态：保留台名、定时和播放控制；与 CSS 收起位移保持一致。 */
export default function MiniPlayer({
  station,
  status,
  playing,
  erroring,
  failedForAutoplay,
  onToggle,
  onExpand,
}: Props) {
  return (
    <div className="mini-player absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-3 sm:hidden">
      <button
        type="button"
        onClick={onExpand}
        aria-label="展开播放器"
        aria-expanded={false}
        aria-controls="player-body"
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left"
      >
        <span className="w-full truncate text-[14px] text-ink">{station.name}</span>
        <SleepControl compact />
      </button>
      <PlayToggle playing={playing} erroring={erroring && !failedForAutoplay} status={status} onToggle={onToggle} />
      <button
        type="button"
        onClick={onExpand}
        aria-label="展开播放器控制"
        className="h-11 px-2 text-[12px] text-muted"
      >
        展开
      </button>
    </div>
  );
}
