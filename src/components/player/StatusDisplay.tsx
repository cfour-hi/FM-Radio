import { cn } from "../../lib/cn";
import { cautionOf } from "../../lib/capability";
import { usePlayer } from "../../store/player";
import { flagOf, stationMeta } from "../StationRow";
import type { EngineStatus } from "../../player/engine";
import type { Station } from "../../lib/types";

export function StatusBadge({ status }: { status: EngineStatus }) {
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
        "num shrink-0 rounded-[3px] border px-1.5 py-px text-[9px] uppercase tracking-[0.16em]",
        tone,
      )}
    >
      {label}
    </span>
  );
}

/** 调谐期间显示电台详细信息，减少等待焦虑。 */
export function TuningInfo({ station }: { station: Station }) {
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
