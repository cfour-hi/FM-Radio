import { memo, useDeferredValue, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawerBrowse from "./drawer/DrawerBrowse";
import DrawerFilters from "./drawer/DrawerFilters";
import DrawerHidden from "./drawer/DrawerHidden";
import DrawerMultiList from "./drawer/DrawerMultiList";
import { buildBrowseGroups } from "../lib/browseGroups";
import DrawerNearby from "./drawer/DrawerNearby";
import DrawerResults from "./drawer/DrawerResults";
import DrawerSearchBar from "./drawer/DrawerSearchBar";
import DrawerTabs, { type Tab } from "./drawer/DrawerTabs";
import { regionLabel } from "../lib/cnEnrichment";
import { buildLocalGroups, nearbyQueue, type LocalGroups } from "../lib/localFromData";
import { loadMapCatalog } from "../lib/mapStations";
import { languageOptions, matchesFilters } from "../lib/stationDiscovery";
import { searchStations } from "../lib/stationSearch";
import { isPlayable } from "../lib/stationFilter";
import type { Station } from "../lib/types";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useDragGesture } from "../hooks/useDragGesture";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useIsCompact } from "../hooks/useIsCompact";
import { usePresence } from "../hooks/usePresence";
import { isPresent } from "../lib/presence";
import { decideDismiss } from "../lib/swipeGesture";
import { useWhereAmI } from "../lib/whereami";
import { nearestStations, nearbyDistanceLabel } from "../lib/nearbyStations";

/*
 * 地图右侧的电台抽屉。
 *
 * 首页删掉列表页之后，收藏 / 最近 / 附近（浏览器定位）没有地方去了，
 * 全收进这个抽屉，三个 tab 切换。顶部一个台名搜索框，结果也进抽屉、
 * 能在地图上定位的就高亮飞过去，不能定位的只播。
 *
 * 搜索覆盖「全部 https 可播台」：有坐标的来自 core/rest，无坐标的来自
 * catalog（输入两个字后才懒加载）。无坐标台在行尾标「无法定位」。
 *
 * 纯展示部分拆在 components/drawer/ 下；这个文件只保留状态、数据合并
 * 与手势/焦点等生命周期。
 */

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
  /** 深链 ?c=&p= 时直接落在「国家」tab */
  initialTab?: Tab | undefined;
  browseSeed?: { country: string; province: string | null } | null;
};

/** 少于此字数不拉全球目录（无坐标台），先只搜地图上已有的电台。 */
const CATALOG_MIN_QUERY = 2;

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
  initialTab,
  browseSeed = null,
}: Props) {
  const { where, loading: locating, error: locationError,
    selectProvince, requestBrowserLocation } = useWhereAmI();
  const supportsGeolocation =
    typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const favorites = useLibrary((s) => s.favorites);
  const recents = useLibrary((s) => s.recents);
  const hidden = useLibrary((s) => s.hidden);
  const hiddenIds = useLibrary((s) => s.hiddenIds);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);

  const [tab, setTab] = useState<Tab>(initialTab ?? "nearby");
  const [hiddenView, setHiddenView] = useState(false);
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
  const catalogEligible = filtering || q.length >= CATALOG_MIN_QUERY || tab === "browse";
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
  /* 附近、推荐、搜索都排除隐藏台；收藏与最近仍显示，但会标注 */
  const visibleStations = useMemo(
    () => stations.filter((s) => !hiddenIds.has(s.id)),
    [stations, hiddenIds],
  );
  const groups: LocalGroups | null = useMemo(
    () => (needsNearby && province ? buildLocalGroups(visibleStations, province, null, capital) : null),
    [needsNearby, visibleStations, province, capital],
  );
  const nearest = useMemo(
    () => needsNearby && where?.source === "browser" ? nearestStations(visibleStations, where.geo) : [],
    [needsNearby, visibleStations, where],
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
  const eligible = useMemo(
    () => allStations.filter((s) => !hiddenIds.has(s.id) && matchesFilters(s, language, genre)),
    [allStations, hiddenIds, language, genre],
  );
  const browsing = tab === "browse" && !searching;
  const browseStations = useMemo(
    () => allStations.filter((s) => !hiddenIds.has(s.id)),
    [allStations, hiddenIds],
  );
  const browseCountries = useMemo(() => buildBrowseGroups(browseStations), [browseStations]);
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
      if (hiddenView) {
        setHiddenView(false);
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, hiddenView]);

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
      visibleStations
        .filter((s) => isPlayable(s, hiddenIds))
        .slice()
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 3),
    [visibleStations, hiddenIds],
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
  // 打开时把键盘焦点留在面板里，关闭时还给打开它的按钮
  useFocusTrap(dragRoot, open);
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

  /*
   * 回车选中走和「点这一行」完全同一条路。
   * 只调 onPickStation 会让回车变成「抽屉关了、但没声」——同一行用鼠标
   * 和用键盘的效果不能不一样。
   */
  const activateFromSearch = useCallback(
    (station: Station, queue: Station[]) => {
      const current = usePlayer.getState().station;
      onPickStation(station);
      if (current?.id === station.id) toggle();
      else play(station, queue);
    },
    [onPickStation, play, toggle],
  );

  // 只有真的不再出现时才摘 DOM；closing 期间元素还得在场上滑出去
  if (!isPresent(phase)) return null;

  const rootProps = {
    ref: dragRoot,
    id: "station-drawer",
    tabIndex: -1,
    "aria-modal": "true",
    "data-state": phase,
    "data-dragging": dragging ? "true" : undefined,
    onPointerDown: drag.onPointerDown,
    onClickCapture: drag.onClickCapture,
    className: DRAWER_ROOT,
  } as const;

  /* 已隐藏的台：恢复入口，盖过 tab 与搜索 */
  if (hiddenView) {
    return (
      <div {...rootProps} role="dialog" aria-label="已隐藏的电台">
        <DrawerHidden
          entries={hidden}
          onBack={() => setHiddenView(false)}
          onClose={onClose}
          onRestore={(id) => useLibrary.getState().unhideStation(id)}
          onRestoreAll={() => useLibrary.getState().unhideAllStations()}
        />
      </div>
    );
  }

  /* 多命中视图：地图上点到的重叠台，抽屉只列这几个，盖过 tab 与搜索 */
  if (multiStations && multiStations.length > 0) {
    return (
      <div {...rootProps} role="dialog" aria-label="这一带的电台">
        <DrawerMultiList
          stations={multiStations}
          onBack={onClearMulti}
          onClose={onClose}
          onPick={onPickStation}
        />
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
      <DrawerSearchBar
        inputRef={inputRef}
        query={query}
        onQueryChange={setQuery}
        onFocusSearch={onSearchFocus}
        onClose={onClose}
        items={items}
        active={active}
        onActiveChange={setActive}
        onActivate={activateFromSearch}
      />

      <DrawerTabs
        tab={tab}
        searching={searching}
        onSelect={(next) => {
          setTab(next);
          setQuery("");
          setLanguage("");
          setGenre("");
          setHiddenView(false);
        }}
      />

      {!browsing && (
        <DrawerFilters
          languages={languages}
          language={language}
          genre={genre}
          filtering={filtering}
          onLanguage={setLanguage}
          onGenre={setGenre}
          onClear={() => {
            setLanguage("");
            setGenre("");
          }}
        />
      )}

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

      {browsing && (catalog === null || catalogError) && (
        <div role="status" className="border-b border-line px-4 py-2 text-[12px] text-dim">
          {catalogError ? (
            <>
              完整目录加载失败，仅显示已加载电台。
              <button type="button" onClick={() => setCatalogRetry((n) => n + 1)} className="ml-2 text-signal">重试</button>
            </>
          ) : (
            "正在补全目录…"
          )}
        </div>
      )}

      {/* 浏览器坐标仅参与本地距离计算；手选地区是独立的省内目录模式。 */}
      {showNearby && (
        <DrawerNearby
          where={where}
          locating={locating}
          locationError={locationError}
          supportsGeolocation={supportsGeolocation}
          nearestCount={nearest.length}
          nearbyLabel={nearbyLabel}
          onRequestLocation={requestBrowserLocation}
          onSelectProvince={selectProvince}
        />
      )}

      {browsing ? (
        <DrawerBrowse
          stations={browseStations}
          countries={browseCountries}
          seed={browseSeed}
          onPickStation={onPickStation}
        />
      ) : (
        <DrawerResults
          items={items}
          active={active}
          searching={searching}
          deferredQuery={deferredQuery}
          emptyText={emptyText}
          showNearby={showNearby}
          whereSource={where?.source ?? null}
          distanceNotes={distanceNotes}
          topPicks={topPicks}
          filtering={filtering}
          total={results.total}
          hiddenIds={hiddenIds}
          onPickStation={onPickStation}
          onLoadMore={() => setVisibleCount((count) => count + 50)}
        />
      )}

      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setHiddenView(true)}
          className="min-h-11 shrink-0 border-t border-line px-4 text-left text-[12px] text-dim transition-colors hover:text-ink"
        >
          已隐藏 {hidden.length} 个 · 管理
        </button>
      )}
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
