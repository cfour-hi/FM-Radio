import StationRow from "../StationRow";
import type { Station } from "../../lib/types";
import type { Where } from "../../lib/whereami";

type Props = {
  items: Station[];
  active: number;
  searching: boolean;
  deferredQuery: string;
  emptyText: string;
  showNearby: boolean;
  whereSource: Where["source"] | null;
  distanceNotes: Map<string, string>;
  topPicks: Station[];
  filtering: boolean;
  total: number;
  hiddenIds: ReadonlySet<string>;
  onPickStation: (station: Station) => void;
  onLoadMore: () => void;
};

/*
 * 列表本体。
 *
 * 空结果时垫三个真能播的热门台，别让人停在死胡同里；搜索态还会提示
 * 可以按省份、城市、国家找。列表满 50 条时给「加载更多」。
 */
export default function DrawerResults({
  items,
  active,
  searching,
  deferredQuery,
  emptyText,
  showNearby,
  whereSource,
  distanceNotes,
  topPicks,
  filtering,
  total,
  hiddenIds,
  onPickStation,
  onLoadMore,
}: Props) {
  const noteFor = (station: Station): string => {
    if (hiddenIds.has(station.id)) return "已隐藏";
    if (showNearby && whereSource === "browser") return distanceNotes.get(station.id) ?? "";
    return station.geo ? "" : "无法定位";
  };

  return (
    <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
      {items.length === 0 ? (
        <div className="px-3 py-8 text-center text-[12px] text-muted">
          <p>{emptyText}</p>
          {searching && (
            <>
              <p className="mt-2 text-[12px] text-dim">
                台名之外也可以搜省份、城市或国家，例如 湖南、长沙、法国
              </p>
              {!filtering && topPicks.length > 0 && (
                <div className="mt-5 text-left">
                  <p className="num mb-1 px-2 text-[9px] uppercase tracking-[0.16em] text-dim">
                    不如先听这些
                  </p>
                  <ul role="listbox" aria-label="推荐电台">
                    {topPicks.map((station, index) => (
                      <StationRow
                        key={station.id}
                        station={station}
                        index={index}
                        queue={topPicks}
                        compact
                        onPick={onPickStation}
                        note=""
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <ul id="drawer-results" role="listbox" aria-label="电台列表">
            {items.map((station, index) => (
              <StationRow
                key={station.id}
                station={station}
                index={index}
                queue={items}
                compact
                active={index === active}
                query={searching ? deferredQuery : undefined}
                onPick={onPickStation}
                note={noteFor(station)}
              />
            ))}
          </ul>
          {searching && items.length < total && (
            <button
              type="button"
              onClick={onLoadMore}
              className="mx-4 my-3 min-h-11 rounded border border-line px-4 text-[13px] text-signal"
            >
              加载更多（还有 {total - items.length} 个）
            </button>
          )}
        </>
      )}
    </div>
  );
}
