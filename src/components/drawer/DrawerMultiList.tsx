import StationRow from "../StationRow";
import type { Station } from "../../lib/types";

type Props = {
  stations: Station[];
  onBack: () => void;
  onClose: () => void;
  onPick: (station: Station) => void;
};

/** 地图上点到的重叠台：只列这几个，盖过 tab 与搜索。 */
export default function DrawerMultiList({ stations, onBack, onClose, onPick }: Props) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <p className="num flex-1 text-[13px] text-ink">这一带 {stations.length} 个台</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起面板"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
        <ul role="listbox" aria-label="这一带的电台">
          {stations.map((station, index) => (
            <StationRow
              key={station.id}
              station={station}
              index={index}
              queue={stations}
              compact
              onPick={onPick}
              note=""
            />
          ))}
        </ul>
      </div>
    </>
  );
}
