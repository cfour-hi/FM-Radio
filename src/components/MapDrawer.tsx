import { memo, useDeferredValue, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StationRow from "./StationRow";
import { regionLabel } from "../lib/cnEnrichment";
import { buildLocalGroups, nearbyQueue, type LocalGroups } from "../lib/localFromData";
import { loadMapCatalog } from "../lib/mapStations";
import { GENRES, LANGUAGE_LABELS, languageOptions, matchesFilters } from "../lib/stationDiscovery";
import { searchStations } from "../lib/stationSearch";
import { checkSupport } from "../lib/capability";
import type { Station } from "../lib/types";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useDragGesture } from "../hooks/useDragGesture";
import { useIsCompact } from "../hooks/useIsCompact";
import { usePresence } from "../hooks/usePresence";
import { isPresent } from "../lib/presence";
import { decideDismiss } from "../lib/swipeGesture";
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
  /** 每 +1 就把焦点送进搜索框（全局「/」用；抽屉没开时由页面先打开它） */
  searchFocusToken?: number;
};

/** 少于此字数不拉全球目录（无坐标台），先只搜地图上已有的电台。 */
const CATALOG_MIN_QUERY = 2;

const TABS: { key: Tab; label: string }[] = [
  { key: "search", label: "全部" },
  { key: "nearby", label: "附近" },
  { key: "favorites", label: "收藏" },
  { key: "recents", label: "最近" },
];

/*
 * 两个视图是同一块面板的两种内容，根元素只能有一份定义。
 *
 * 这里刻意把 inset-y-0 拆成 bottom-0 + sm:top-0：移动端要让开顶部 Header，
 * 而这个偏移写在 index.css 的 .drawer 里（components 层）。留着 inset-y-0
 * 会让 top:0 由工具类写死，components 层的规则永远输给它。
 */
const DRAWER_ROOT =
  "drawer glass-panel absolute right-0 bottom-0 z-30 flex w-full flex-col sm:top-0 sm:w-[360px]";

function DrawerContent({
  open,
  onClose,
  stations,
  capitals,
  onPickStation,
  multiStations,
  onClearMulti,
  searchFocusToken = 0,
}: Props) {
  const { where, loading: locating, error: locationError,
    selectProvince, requestBrowserLocation } = useWhereAmI();
  const supportsGeolocation =
    typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const favorites = useLibrary((s) => s.favorites);
  const recents = useLibrary((s) => s.recents);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);

  const [tab, setTab] = useState<Tab>("nearby");
  const [visibleCount, setVisibleCount] = useState(50);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [genre, setGenre] = useState("");
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalog, setCatalog] = useState<Station[] | null>(null);

  const q = query.trim();
  const filtering = Boolean(language || genre);
  const searching = q.length > 0 || filtering || tab === "search";
  /*
   * 一个字的命中面太大：1.45MB 的全球目录换不来几条有用的结果。
   * 筛选是显式操作，用户已经知道自己在缩小范围，这时才按需加载整份目录。
   */
  const catalogEligible = filtering || q.length >= CATALOG_MIN_QUERY;
  useEffect(() => { setVisibleCount(50); }, [q, language, genre, tab]);
  /*
   * 退场这 180ms 里元素还看得见，内容必须留着。
   *
   * 下面几个 useMemo 原来都用 open 判定要不要算数据，关抽屉瞬间就清空了，
   * 滑出去的是一块空白面板。live 只在「真的不再出现」时才为假。
   */
  const phase = usePresence(open);
  const live = open || phase === "closing";
  const showNearby = !searching && tab === "nearby";
  const needsNearby = live && !multiStations?.length && showNearby;
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

  /* 聚焦搜索框：切到搜索 tab。目录不在这里拉，见下面的字数门槛 */
  const onSearchFocus = useCallback(() => {
    setTab("search");
  }, []);

  /*
   * 无坐标台目录的懒加载挂在「搜索词够长或开始筛选」上，而不是 focus 事件上。
   * 原因：headless / 合成环境下 element.focus() 不一定触发 React 的 onFocus，
   * 但键入一定会触发 onChange，这条路更可靠。loadMapCatalog 内部有 pending
   * 缓存，重复触发无害。
   */
  useEffect(() => {
    if (!live || !catalogEligible || catalog !== null) return;
    let alive = true;
    setCatalogError(false);
    loadMapCatalog().then((data) => { if (alive) setCatalog(data); }).catch(() => { if (alive) setCatalogError(true); });
    return () => { alive = false; };
  }, [live, catalogEligible, catalog, catalogRetry]);

  const allStations = useMemo(() => [...new Map([...stations, ...(catalog ?? [])].map((s) => [s.id, s])).values()], [stations, catalog]);
  const languages = useMemo(() => languageOptions(allStations), [allStations]);
  const eligible = useMemo(() => allStations.filter((s) => matchesFilters(s, language, genre)), [allStations, language, genre]);
  const results = useMemo(() => {
    if (!live || !searching) return { hits: [] as Station[], regionTotal: 0, total: 0 };
    if (deferredQuery) {
      const result = searchStations(eligible, deferredQuery, { limit: eligible.length, regionLimit: eligible.length });
      return { ...result, hits: result.hits, total: result.hits.length };
    }
    return { hits: eligible.slice().sort((a, b) => b.clicks - a.clicks), regionTotal: 0, total: eligible.length };
  }, [live, deferredQuery, searching, eligible]);

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

  /* 键盘浏览：↑↓ 移动、Enter 播放。输入框里的一串键不会漏给全局快捷键。 */
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // 结果一换就把高亮收回，否则会停在一条已经不在列表里的行上
  useEffect(() => {
    setActive(-1);
  }, [results]);

  /* 全局「/」：抽屉刚被打开时，把焦点送进搜索框 */
  useEffect(() => {
    if (!open || searchFocusToken === 0) return;
    // 抽屉是延迟挂载的，等这一帧过完输入框才在文档里
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, searchFocusToken]);

  /* 搜不到时垫三个真能播的热门台，别让人停在死胡同里 */
  const topPicks = useMemo(
    () =>
      stations
        .filter((s) => !s.sslError && checkSupport(s).ok)
        .slice()
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 3),
    [stations],
  );

  /*
   * 右滑关闭。
   *
   * 只在窄屏挂上：桌面那张 360px 的面板本来就不该被手指推走，而且鼠标
   * 拖动和选词、拖滚动条会打架。
   *
   * 列表的纵向滚动没被抢——touch-action 在 CSS 里设成 pan-y，浏览器先
   * 判方向，纵向它自己处理（并给我们一个 pointercancel，于是这里只回弹）。
   */
  const compact = useIsCompact();
  const [dragging, setDragging] = useState(false);
  const dragRoot = useRef<HTMLDivElement>(null);
  const drag = useDragGesture({
    enabled: open && compact,
    axis: "x",
    varName: "--drawer-x",
    // 面板宽度就是行程：滑出去正好整块离场
    getMax: (el) => el.offsetWidth,
    onSettle: ({ delta, velocity }) => {
      const size = dragRoot.current?.offsetWidth ?? 0;
      if (decideDismiss({ distance: delta, velocity, size })) onClose();
    },
    onDragChange: setDragging,
  });

  // 只有真的不再出现时才摘 DOM；closing 期间元素还得在场上滑出去
  if (!isPresent(phase)) return null;

  const rootProps = {
    ref: dragRoot,
    "data-state": phase,
    "data-dragging": dragging ? "true" : undefined,
    onPointerDown: drag.onPointerDown,
    onClickCapture: drag.onClickCapture,
    className: DRAWER_ROOT,
  } as const;

  /* 多命中视图：地图上点到的重叠台，抽屉只列这几个，盖过 tab 与搜索 */
  if (multiStations && multiStations.length > 0) {
    return (
      <div {...rootProps} role="dialog" aria-label="这一带的电台">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <button
            type="button"
            onClick={onClearMulti}
            aria-label="返回"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-dim transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div data-drawer-scroll className="min-h-0 flex-1 overflow-y-auto">
          <ul role="listbox" aria-label="这一带的电台">
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
    items = results.hits.slice(0, visibleCount);
    emptyText = "没找到匹配的台";
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
    <div {...rootProps} role="dialog" aria-label="电台面板">
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
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onSearchFocus}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, -1));
                return;
              }
              if (event.key === "Enter") {
                const station = items[active === -1 ? 0 : active];
                if (!station) return;
                event.preventDefault();
                /*
                 * 走和「点这一行」完全同一条路。
                 * 只调 onPickStation 会让回车变成「抽屉关了、但没声」——
                 * 同一行用鼠标和用键盘的效果不能不一样。
                 */
                const current = usePlayer.getState().station;
                onPickStation(station);
                if (current?.id === station.id) toggle();
                else play(station, items);
                return;
              }
              if (event.key === "Escape") {
                /*
                 * 必须自己拦住：全局 Esc 只做 blur，会先把输入框踢掉焦点，
                 * 用户想「先清词、再退出」的预期就完不成了。
                 */
                event.stopPropagation();
                if (query) {
                  setQuery("");
                  setActive(-1);
                } else {
                  event.currentTarget.blur();
                }
              }
            }}
            data-search-input
            placeholder="搜台名、省份、城市或国家…"
            aria-label="搜索电台"
            aria-controls="drawer-results"
            className="h-9 w-full rounded-[6px] border border-line bg-base/60 pl-8 pr-3 text-[13px] text-ink placeholder:text-dim focus:border-signal/50 focus:outline-none"
          />
        </div>
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

      {/* tab */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {TABS.map((t) => {
          const active = t.key === "search" ? searching : !searching && tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setQuery("");
                setLanguage("");
                setGenre("");
              }}
              aria-pressed={active}
              className={`h-10 rounded-[6px] px-3 text-[13px] transition-colors ${
                active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <details className="border-b border-line px-4 py-1">
        <summary className="ml-4 min-h-9 cursor-pointer list-item py-2 text-[13px] text-muted">语言与类型</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select aria-label="筛选语言" value={language} onChange={(event) => setLanguage(event.target.value)} className="h-10 min-w-0 rounded border border-line bg-base px-2 text-[12px] text-ink">
            <option value="">全部语言</option>
            {languages.map((key) => <option key={key} value={key}>{LANGUAGE_LABELS[key] ?? key}</option>)}
          </select>
          <select aria-label="筛选类型" value={genre} onChange={(event) => setGenre(event.target.value)} className="h-10 min-w-0 rounded border border-line bg-base px-2 text-[12px] text-ink">
            <option value="">全部类型</option>
            {GENRES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>
      </details>
      {filtering && <div className="flex flex-wrap items-center gap-2 px-4 py-1">
        {language && <button type="button" aria-label="移除语言筛选" onClick={() => setLanguage("")} className="min-h-9 rounded border border-line px-2 text-[12px] text-signal">{LANGUAGE_LABELS[language] ?? language} ×</button>}
        {genre && <button type="button" aria-label="移除类型筛选" onClick={() => setGenre("")} className="min-h-9 rounded border border-line px-2 text-[12px] text-signal">{GENRES.find((item) => item.key === genre)?.label} ×</button>}
        <button type="button" onClick={() => { setLanguage(""); setGenre(""); }} className="min-h-9 px-1 text-[12px] text-muted">清除筛选</button>
      </div>}

      {searching && (
        <div role="status" className="border-b border-line px-4 py-2 text-[12px] text-dim">
          {catalog === null && !catalogError && (catalogEligible
            ? "正在补全目录… "
            : `输入至少 ${CATALOG_MIN_QUERY} 个字可搜索全球目录，当前只列出地图上的电台。 `)}
          {catalogError && (
            <>
              完整目录加载失败，当前结果仅含已加载电台。
              <button type="button" onClick={() => setCatalogRetry((n) => n + 1)} className="ml-2 text-signal">重试</button>
            </>
          )}
          {catalog === null && !catalogEligible ? "地图电台" : "全部电台"} · {results.total} 个结果 · 已显示 {items.length} 个
        </div>
      )}

      {/* 浏览器坐标仅参与本地距离计算；手选地区是独立的省内目录模式。 */}
      {showNearby && (
        <div className="border-b border-line px-4 py-3 text-[12px] text-muted">
          {where?.source === "browser" ? (
            <div className="mb-2">
              <p className="text-ink">已加载电台中距离最近的 {nearest.length} 个台</p>
              <p className="mt-1 text-[12px] text-dim">
                按直线距离排序 · 定位精度{accuracyLabel(where.accuracy)}
              </p>
            </div>
          ) : nearbyLabel && <p className="mb-2">已选地区 · <span className="text-ink">{nearbyLabel}</span></p>}
          {supportsGeolocation ? (
            <button type="button" onClick={requestBrowserLocation} disabled={locating}
              className="mb-3 rounded-[6px] border border-line px-3 py-1.5 text-ink transition-colors hover:bg-surface disabled:opacity-50">
              {locating ? "正在获取位置…" : where?.source === "browser" ? "更新我的位置" : "用我的位置"}
            </button>
          ) : <p className="mb-2 text-[12px] text-dim">当前浏览器不支持定位，请手动选择地区。</p>}
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
          <p role="status" className="mt-2 text-[12px] text-dim">
            {locating ? "正在获取位置，也可以直接选择地区。" : locationError}
          </p>
        </div>
      )}

      {/* 列表 */}
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
                note={showNearby && where?.source === "browser" ? distanceNotes.get(station.id) ?? "" : station.geo ? "" : "无法定位"}
              />
            ))}
          </ul>
          {searching && items.length < results.total && <button type="button" onClick={() => setVisibleCount((count) => count + 50)} className="mx-4 my-3 min-h-11 rounded border border-line px-4 text-[13px] text-signal">加载更多（还有 {results.total - items.length} 个）</button>}
          </>
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
