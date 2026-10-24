import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Hud from "../components/Hud";
import Starfield from "../components/Starfield";
import MapDrawer from "../components/MapDrawer";
import FirstRunGuide, { type GuideAction } from "../components/FirstRunGuide";
import { loadMapCore, loadMapRest, type CoreMeta, type MapDataset } from "../lib/mapStations";
import { isGuideForced, shouldShowGuide } from "../lib/onboarding";
import type { Station } from "../lib/types";
import { useMapStore } from "../store/map";
import { usePlayer, readLastStation } from "../store/player";
import type { Focus } from "../map/WorldMap";

/*
 * MapLibre 那一坨接近 300KB gzip，是首页里最重的一块。
 * 但首页不能为它整屏空白——先把 HUD、按钮、抽屉这些外壳画出来，
 * 球体在它们之后加载。所以 WorldMap 在内部懒加载，Suspense 兜住中间态。
 */
const loadWorldMap = () => import("../map/WorldMap");
const WorldMap = lazy(loadWorldMap);

/** 右上角那排图标按钮长得一样，样式收在一处 */
const ICON_BUTTON =
  "pointer-events-auto grid h-8 w-8 place-items-center rounded-[6px] border bg-base/55 backdrop-blur transition-colors";

/* meta 还没加载出来时的兜底，模块级只建一次，避免每次渲染都新建 Map 触发重算 */
const EMPTY_STATIONS: Station[] = [];
const EMPTY_CAPITALS = new Map<string, string>();

export default function MapPage() {
  const [data, setData] = useState<MapDataset | null>(null);
  const [meta, setMeta] = useState<CoreMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [retry, setRetry] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [multiStations, setMultiStations] = useState<Station[] | null>(null);
  const [view, setView] = useState<{ lat: number; lon: number; zoom: number } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideAsked = useRef(false);
  const flyHomeToken = useMapStore((s) => s.flyHomeToken);
  const flyHome = useMapStore((s) => s.flyHome);
  /**
   * 台名默认开着。
   *
   * 光点说明「哪里在亮」，名字说明「那里是谁」。名字一开，画面确实会从
   * 一片星空变成带注记的图，但那是这张图该有的样子——它不是壁纸。
   * 密度交给避让算法：两千个台写不下，它会挑点击量高的先占位。
   */
  const [showLabels, setShowLabels] = useState(true);

  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const currentId = usePlayer((s) => s.station?.id ?? null);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    // 地图代码与 core 数据并行下载，避免串行等待；加载错误仍由 lazy 处理。
    void loadWorldMap().catch(() => {});
    loadMapCore()
      .then((core) => {
        if (!alive) return;
        setData(core.dataset);
        setMeta(core.meta);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : "点位数据读取失败");
      });
    return () => {
      alive = false;
    };
  }, [retry]);

  // 首帧完成后再补全境外台，避免 rest 与地图代码、首屏地理数据争抢带宽。
  // 地图不可用时也继续加载，让抽屉仍能搜索和播放完整目录。
  useEffect(() => {
    if (!mapReady && !mapError) return;
    let alive = true;
    const load = () => {
      void loadMapRest().then((rest) => {
        if (!alive) return;
        setData((prev) => {
          if (!prev) return prev;
          const byId = new Map([...prev.byId, ...rest.byId]);
          const stations = [...byId.values()];
          return {
            stations,
            byId,
            generatedAt: rest.generatedAt,
            countries: new Set(stations.map((s) => s.countryCode).filter(Boolean)).size,
          };
        });
      }).catch(() => {
        /* rest 失败不致命，保留 core 的搜索和播放能力 */
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 1500 });
      return () => {
        alive = false;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(load, 0);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [mapReady, mapError, retry]);

  /*
   * 首访引导：等 core 数据到齐再弹，否则会压在全屏「带出坐标」加载层上，
   * 且「随机点亮」没有台可挑。guideAsked 是「只判定一次」的闸门：
   * rest 分片合并会让 data 换新对象，没有它会重复弹。
   */
  useEffect(() => {
    if (guideAsked.current) return;
    if (!data || loadError || mapError) return;
    guideAsked.current = true;
    if (!shouldShowGuide()) return;
    // 上线前就用过站的人没有引导标记但有上次电台，视为「已上手」不再打扰；
    // 但 ?guide=1 是明确要求重看，不能被这层迁移规则拦掉。
    if (!isGuideForced() && readLastStation()) return;
    setGuideOpen(true);
  }, [data, loadError, mapError]);

  // 弹卡之后地图才报错：立刻收起，避免引导浮在错误层之上
  useEffect(() => {
    if (mapError) setGuideOpen(false);
  }, [mapError]);

  const stations = data?.stations ?? EMPTY_STATIONS;
  const handleReady = useCallback(() => setMapReady(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const clearMulti = useCallback(() => setMultiStations(null), []);

  const playStation = useCallback(
    (station: Station) => {
      if (station.id === currentId) {
        toggle();
        return;
      }
      play(station, stations);
    },
    [currentId, play, stations, toggle],
  );

  const flyToStation = useCallback((station: Station) => {
    if (station.geo) {
      setFocus({ lon: station.geo.lon, lat: station.geo.lat, token: Date.now() });
    }
  }, []);

  /*
   * 点图上的光是「点哪听哪」，和列表行点击一致：不让人先点一下再点一下。
   * 想安静地看看这颗球上有哪些地方在亮，就别点。
   */
  const handleMapSelect = useCallback(
    (station: Station) => {
      flyToStation(station);
      playStation(station);
    },
    [flyToStation, playStation],
  );

  /*
   * 抽屉里点台：有坐标的飞过去看，顺便关掉抽屉；无坐标的只在抽屉里播，
   * 地图上本来就没有它的点，没有可飞的地方。
   */
  const handlePickStation = useCallback((station: Station) => {
    if (station.geo) {
      flyToStation(station);
      setDrawerOpen(false);
      setMultiStations(null);
    }
  }, []);

  /* 地图上点到的重叠台：抽屉切到「这一带 N 个台」，不自动播 */
  const handleMultiSelect = useCallback((stations: Station[]) => {
    setMultiStations(stations);
    setDrawerOpen(true);
  }, []);

  const randomOnMap = useCallback(() => {
    if (stations.length === 0) return;
    // 只在图上点得亮的台里挑，避开证书异常的那些
    const pool = stations.filter((s) => !s.sslError);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) return;
    flyToStation(pick);
    playStation(pick);
  }, [stations, flyToStation, playStation]);

  /* 引导收尾：random 时在同一手势任务内播放，避免被自动播放策略拦截 */
  const finishGuide = useCallback(
    (action: GuideAction) => {
      setGuideOpen(false);
      if (action === "random") randomOnMap();
    },
    [randomOnMap],
  );

  /*
   * 高亮跟随正在播的台。
   *
   * 原来这里还有一个「选中电台卡片」，和播放条各说一遍台名和地区。
   * 现在所有选台路径都是点了就播，播放条就是选中台唯一的名片，
   * 高亮直接用 currentId，不再维护第二个「选中」状态。
   */
  const highlightId = currentId;

  /*
   * 整屏。
   *
   * 外壳（logo、播放器、按钮）全部改成了浮在地图上的元素，所以地图可以
   * 直接铺满整个视口——不必再为 56px 的顶栏和 83px 的播放条各让出一条。
   *
   * 这不只是让画面更干净：球体尺寸是按容器短边反解出来的（见 WorldMap 的
   * globeTargetDiameter），容器变高之后球会跟着变大——1400×900 下从约
   * 670px 涨到约 792px。收拢外壳真正的收益在这里。
   *
   * 页面本身没有任何标题和统计数字：一颗占满窗口的球不需要旁边再挂个
   * 「地图」两个字，左上角那枚 logo 已经说明了这是什么。
   */
  return (
    <section className="map-shell fixed inset-0 z-0 overflow-hidden bg-base-2">
      {/* 光点只能点，键盘用户需要一条替代路径，先说清楚在哪 */}
      <p className="sr-only">
        世界电台地图，默认对着中国区域，每个光点是一个电台并标有名称，点击即可收听。
        拖动地球可以看到其他地区。用键盘时，可以按右上角的「随机点亮」挑一个台，
        或者打开电台面板搜索挑选。
      </p>

      {!loadError && data && (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-10 grid place-items-center bg-base-2">
              <div className="text-center">
                <span className="tuning-ring mx-auto" aria-hidden />
                <p className="num mt-4 text-[11px] uppercase tracking-[0.18em] text-cold">铺开地球</p>
              </div>
            </div>
          }
        >
          <WorldMap
            stations={stations}
            highlightId={highlightId}
            focus={focus}
            resetToken={flyHomeToken}
            showLabels={showLabels}
            onSelect={handleMapSelect}
            onMultiSelect={handleMultiSelect}
            onViewChange={setView}
            onReady={handleReady}
            onFail={setMapError}
          />
        </Suspense>
      )}

      {/* 太空星云：淡色云气垫底，柔化球外空旷，blur 后自然形成球体边缘的柔光 */}
      <div aria-hidden className="map-nebula pointer-events-none absolute inset-0 z-[4]" />

      {/* 太空星空：铺满窗口、中心镂空露出球体，只让星星待在球外 */}
      <Starfield />

      {/* 球体明暗：左上受光、右下阴影，让球有体积感而不是一张平贴图 */}
      <div aria-hidden className="map-shading pointer-events-none absolute inset-0 z-10" />

      {/* 边缘压暗，让球体浮在夜空中，而不是一张贴满屏幕的贴图 */}
      <div aria-hidden className="map-vignette pointer-events-none absolute inset-0 z-10" />

      {/* 四角角标 + 经纬度读数 */}
      <Hud view={view} total={stations.length} />

      {/*
       * 右上角操作：只留图标，文字交给 aria-label 和 title。
       *
       * 四个文字按钮竖排时占了整列右上角，把地图的一角压掉一大块。
       * 换成一行方形图标之后，同样的功能只占一条 32px 高的横带；
       * 图标含义对熟悉这类工具的人一眼就懂，不熟的靠 hover 提示。
       * 按钮组顶边与左上角 Header 胶囊对齐（sm:top-6 / 移动端 top-4），
       * 和中间的 HUD 读数组成一条齐平的顶部仪表带。
       */}
      <div className="pointer-events-none absolute right-3 top-4 z-20 flex items-center gap-1.5 sm:right-5 sm:top-6">
        {/* 电台面板：右侧抽屉 */}
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-pressed={drawerOpen}
          aria-label="电台面板"
          title="电台面板"
          className={`${ICON_BUTTON} ${
            drawerOpen ? "border-signal/40 text-ink" : "border-line text-muted hover:text-ink"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[15px] w-[15px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <path d="M14.5 4.5v15" />
          </svg>
        </button>

        {/* 随机点亮：骰子 */}
        <button
          type="button"
          onClick={randomOnMap}
          disabled={stations.length === 0}
          aria-label="随机点亮一个台"
          title="随机点亮"
          className={`${ICON_BUTTON} border-signal/30 text-signal hover:border-signal/60 disabled:opacity-40`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[15px] w-[15px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="4" y="4" width="16" height="16" rx="3.5" />
            <circle cx="8.5" cy="8.5" r="1.05" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="8.5" r="1.05" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.05" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="15.5" r="1.05" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="15.5" r="1.05" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {/* 台名开关：眼睛，关掉时加一道斜线 */}
        <button
          type="button"
          onClick={() => setShowLabels((v) => !v)}
          aria-pressed={showLabels}
          aria-label={showLabels ? "隐藏台名" : "显示台名"}
          title={showLabels ? "隐藏台名" : "显示台名"}
          className={`${ICON_BUTTON} ${
            showLabels ? "border-signal/40 text-ink" : "border-line text-muted hover:text-ink"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[15px] w-[15px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" />
            <circle cx="12" cy="12" r="2.6" />
            {!showLabels && <path d="M4 4l16 16" />}
          </svg>
        </button>

        {/* 回到世界：地球 */}
        <button
          type="button"
          onClick={flyHome}
          aria-label="回到世界"
          title="回到世界"
          className={`${ICON_BUTTON} border-line text-muted hover:text-ink`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[15px] w-[15px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17" />
            <path d="M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5S14.3 18.1 12 20.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5z" />
          </svg>
        </button>
      </div>

      {/* 电台面板：附近 / 收藏 / 最近 / 搜索 */}
      <MapDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        stations={stations}
        capitals={meta?.capitals ?? EMPTY_CAPITALS}
        onPickStation={handlePickStation}
        multiStations={multiStations}
        onClearMulti={clearMulti}
      />

      {/* 加载 / 失败 */}
      {loadError && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-base/90 px-6 text-center">
          <div className="max-w-sm">
            <p className="text-[13px] text-muted">{loadError}</p>
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="mt-4 h-9 rounded-[10px] border border-line px-4 text-[12px] text-muted transition-colors hover:text-ink"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {mapError && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-base/90 px-6 text-center">
          <div className="max-w-sm">
            <p className="text-[13px] text-muted">{mapError}</p>
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="mt-4 h-9 rounded-[10px] border border-line px-4 text-[12px] text-muted transition-colors hover:text-ink"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {!loadError && !data && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-base/80 px-6 text-center">
          <div>
            <span className="tuning-ring mx-auto" aria-hidden />
            <p className="num mt-4 text-[11px] uppercase tracking-[0.18em] text-cold">带出坐标</p>
          </div>
        </div>
      )}

      {!mapReady && data && !mapError && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 text-center">
          <span className="num text-[10px] uppercase tracking-[0.18em] text-dim">正在铺开地球…</span>
        </div>
      )}

      {/* 首访欢迎卡：原生 dialog 进 top layer，能压过 Header/播放条 */}
      {guideOpen && <FirstRunGuide onFinish={finishGuide} />}
    </section>
  );
}
