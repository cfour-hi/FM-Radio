import { memo, useDeferredValue, useCallback, useEffect, useMemo, useState } from "react";
import StationRow from "./StationRow";
import { regionLabel } from "../lib/cnEnrichment";
import { buildLocalGroups, nearbyQueue, type LocalGroups } from "../lib/localFromData";
import { loadMapCatalog, searchByName } from "../lib/mapStations";
import type { Station } from "../lib/types";
import { useLibrary } from "../store/library";
import { useWhereAmI } from "../lib/whereami";
import { CN_REGIONS } from "../lib/cnRegions";
import { accuracyLabel, nearestStations, nearbyDistanceLabel } from "../lib/nearbyStations";

/*
 * 地图右侧的电台抽屉。
 *
 * 首页删掉列表页之后，收藏 / 最近 / 附近（浏览器定位）没有地方去了，
 * 全收进这个抽屉，三个 tab 切换。顶部一个台名搜索框，结果也进抽屉、
 * 能在地图上定位的就高亮飞过去，不能定位的只播。
 *
 * 搜索覆盖「全部 https 可播台」：有坐标的来自 core/rest，无坐标的来自
 * catalog（聚焦搜索框时懒加载）。无坐标台在行尾标「无法定位」。
 */

type Tab = "nearby" | "favorites" | "recents" | "search";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 已加载的有坐标台（core + rest），供附近与搜索 */
  stations: Station[];
  capitals: Map<string, string>;
  /** 点台：有坐标就飞地图 + 高亮（并关抽屉），无坐标只播 */
  onPickStation: (station: Station) => void;
  /** 地图上点到的重叠台，非空时抽屉切到「这一带 N 个台」视图 */
  multiStations: Station[] | null;
  onClearMulti: () => void;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "nearby", label: "附近" },
  { key: "favorites", label: "收藏" },
  { key: "recents", label: "最近" },
];

function DrawerContent({
  open,
  onClose,
  stations,
  capitals,
  onPickStation,
  multiStations,
  onClearMulti,
}: Props) {
  const { where, loading: locating, error: locationError,
    selectProvince, requestBrowserLocation } = useWhereAmI();
  const supportsGeolocation =
    typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const favorites = useLibrary((s) => s.favorites);
  const recents = useLibrary((s) => s.recents);

  const [tab, setTab] = useState<Tab>("nearby");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<Station[] | null>(null);

  const q = query.trim();
  const searching = q.length > 0;
  const showNearby = !searching && (tab === "nearby" || tab === "search");
  const needsNearby = open && !multiStations?.length && showNearby;
  const province = where?.source === "manual" ? where.province : null;
  const capital = province ? (capitals.get(province) ?? "") : "";
  const groups: LocalGroups | null = useMemo(
    () => (needsNearby && province ? buildLocalGroups(stations, province, null, capital) : null),
    [needsNearby, stations, province, capital],
  );
  const nearest = useMemo(
    () => needsNearby && where?.source === "browser" ? nearestStations(stations, where.geo) : [],
    [needsNearby, stations, where],
  );
  const nearbyItems = useMemo(
    () => groups ? nearbyQueue(groups) : nearest.map((item) => item.station),
    [groups, nearest],
  );
  const distanceNotes = useMemo(() => new Map(nearest.map((item) => [
    item.station.id, nearbyDistanceLabel(item, where?.source === "browser" ? where.accuracy : 0),
  ])), [nearest, where]);
  const deferredQuery = useDeferredValue(q);

  /* 聚焦搜索框：切到搜索 tab，并预加载无坐标台目录 */
  const onSearchFocus = useCallback(() => {
    setTab("search");
  }, []);

  /*
   * 无坐标台目录的懒加载挂在「搜索词非空」上，而不是 focus 事件上。
   * 原因：headless / 合成环境下 element.focus() 不一定触发 React 的 onFocus，
   * 但键入一定会触发 onChange，这条路更可靠。loadMapCatalog 内部有 pending
   * 缓存，重复触发无害。
   */
  useEffect(() => {
    if (q && catalog === null) {
      loadMapCatalog().then(setCatalog).catch(() => {
        /* 目录拉不下来，搜索退化为只在图上找 */
      });
    }
  }, [q, catalog]);

  const results = useMemo(() => {
    if (!open || !deferredQuery) return [];
    const mapHits = searchByName(stations, deferredQuery, 50);
    const catHits = catalog ? searchByName(catalog, deferredQuery, 50) : [];
    const seen = new Set<string>();
    const merged: Station[] = [];
    for (const s of [...mapHits, ...catHits].sort((a, b) => b.clicks - a.clicks)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    return merged.slice(0, 50);
  }, [open, deferredQuery, stations, catalog]);

  /* Escape 关抽屉；焦点在输入框里时先让全局快捷键退焦点，第二次再关 */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 原生 dialog 在 top layer 时，Esc 归它自己管，别一次关两层
      if (document.querySelector("dialog[open]")) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /* 多命中视图：地图上点到的重叠台，抽屉只列这几个，盖过 tab 与搜索 */
  if (multiStations && multiStations.length > 0) {
    return (
      <div
        role="dialog"
        aria-label="这一带的电台"
        className="drawer glass-panel absolute inset-y-0 right-0 z-30 flex w-full flex-col sm:w-[360px]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <button
            type="button"
            onClick={onClearMulti}
            aria-label="返回"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <p className="num flex-1 text-[13px] text-ink">这一带 {multiStations.length} 个台</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起面板"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {multiStations.map((station, index) => (
              <StationRow
                key={station.id}
                station={station}
                index={index}
                queue={multiStations}
                compact
                onPick={onPickStation}
                note=""
              />
            ))}
          </ul>
        </div>
      </div>
    );
  }

  let items: Station[];
  let emptyText: string;
  if (searching) {
    items = results;
    emptyText = "没找到这个台，换个名字试试";
  } else if (tab === "favorites") {
    items = favorites;
    emptyText = "还没有收藏。点图上的光点，卡片上就能收藏";
  } else if (tab === "recents") {
    items = recents;
    emptyText = "还没有听过任何台";
  } else {
    items = nearbyItems;
    emptyText = locating ? "正在获取位置…" : where?.source === "browser"
      ? "已加载目录中暂无可计算距离的电台"
      : province ? "该地区暂无电台" : "使用浏览器定位查找附近电台，或手动选择地区";
  }

  const nearbyLabel = province ? regionLabel(province) : null;

  return (
    <div
      role="dialog"
      aria-label="电台面板"
      className="drawer glass-panel absolute inset-y-0 right-0 z-30 flex w-full flex-col sm:w-[360px]"
    >
      {/* 搜索 + 关闭 */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onSearchFocus}
            data-search-input
            placeholder="在图上找台…"
            className="h-9 w-full rounded-[6px] border border-line bg-base/60 pl-8 pr-3 text-[13px] text-ink placeholder:text-dim focus:border-signal/50 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起面板"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/* tab */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {TABS.map((t) => {
          const active = !searching && tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setQuery("");
              }}
              aria-pressed={active}
              className={`h-7 rounded-[6px] px-3 text-[12px] transition-colors ${
                active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 浏览器坐标仅参与本地距离计算；手选地区是独立的省内目录模式。 */}
      {showNearby && (
        <div className="border-b border-line px-4 py-3 text-[12px] text-muted">
          {where?.source === "browser" ? (
            <div className="mb-2">
              <p className="text-ink">已加载电台中距离最近的 {nearest.length} 个台</p>
              <p className="mt-1 text-[11px] text-dim">
                按直线距离排序 · 定位精度{accuracyLabel(where.accuracy)}
              </p>
            </div>
          ) : nearbyLabel && <p className="mb-2">已选地区 · <span className="text-ink">{nearbyLabel}</span></p>}
          {supportsGeolocation ? (
            <button type="button" onClick={requestBrowserLocation} disabled={locating}
              className="mb-3 rounded-[6px] border border-line px-3 py-1.5 text-ink transition-colors hover:bg-surface disabled:opacity-50">
              {locating ? "正在获取位置…" : where?.source === "browser" ? "更新我的位置" : "用我的位置"}
            </button>
          ) : <p className="mb-2 text-[11px] text-dim">当前浏览器不支持定位，请手动选择地区。</p>}
          <label className="flex items-center gap-2">
            <span className="shrink-0">手动选择</span>
            <select
              aria-label="选择附近电台地区"
              value={province ?? ""}
              onChange={(event) => selectProvince(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-base px-2 text-ink"
            >
              <option value="" disabled>请选择省份或地区</option>
              {CN_REGIONS.map((region) => (
                <option key={region.name} value={region.name}>{regionLabel(region.name)}</option>
              ))}
            </select>
          </label>
          <p role="status" className="mt-2 text-[11px] text-dim">
            {locating ? "正在获取位置，也可以直接选择地区。" : locationError}
          </p>
        </div>
      )}

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted">
            <p>{emptyText}</p>

          </div>
        ) : (
          <ul>
            {items.map((station, index) => (
              <StationRow
                key={station.id}
                station={station}
                index={index}
                queue={items}
                compact
                onPick={onPickStation}
                note={showNearby && where?.source === "browser" ? distanceNotes.get(station.id) ?? "" : station.geo ? "" : "无法定位"}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// 首次打开才挂载：关闭后保留实例，避免丢失搜索、目录与定位结果。
function MapDrawer(props: Props) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (props.open) setOpened(true);
  }, [props.open]);
  if (!props.open && !opened) return null;
  return <DrawerContent {...props} />;
}

export default memo(MapDrawer);
