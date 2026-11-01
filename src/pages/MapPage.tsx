import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import RandomExplorer from "../components/RandomExplorer";
import FxSwitcher from "../components/FxSwitcher";
import Hud from "../components/Hud";
import Starfield from "../components/Starfield";
import MapDrawer from "../components/MapDrawer";
import FirstRunGuide, { type GuideAction } from "../components/FirstRunGuide";
import { loadMapCatalog, loadMapCore, loadMapRest, type CoreMeta, type MapDataset } from "../lib/mapStations";
import { readStationId } from "../lib/deepLink";
import { isGuideForced, shouldShowGuide } from "../lib/onboarding";
import { prefersReducedMotion } from "../lib/motion";
import type { Station } from "../lib/types";
import { useMapStore } from "../store/map";
import { useFxStore } from "../store/fx";
import { usePlayer, readLastStation } from "../store/player";

/*
 * MapLibre 那一坨接近 300KB gzip，是首页里最重的一块。
 * 但首页不能为它整屏空白——先把 HUD、按钮、抽屉这些外壳画出来，
 * 球体在它们之后加载。所以 WorldMap 在内部懒加载，Suspense 兜住中间态。
 */
const loadWorldMap = () => import("../map/WorldMap");
const WorldMap = lazy(loadWorldMap);

/*
 * 粒子特效场景同样懒加载：只在第一次切出地球时才下载。
 * 特效是「另一种壁纸」，不该让每个打开首页的人都为它付流量。
 */
const FxScene = lazy(() => import("../fx/FxScene"));

/** 右上角那排图标按钮长得一样，样式收在一处 */
const ICON_BUTTON =
  "pointer-events-auto grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-[6px] border bg-base/55 backdrop-blur transition-colors";

/* meta 还没加载出来时的兜底，模块级只建一次，避免每次渲染都新建 Map 触发重算 */
const EMPTY_STATIONS: Station[] = [];
const EMPTY_CAPITALS = new Map<string, string>();

export default function MapPage() {
  const [data, setData] = useState<MapDataset | null>(null);
  const [meta, setMeta] = useState<CoreMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [multiStations, setMultiStations] = useState<Station[] | null>(null);
  const [view, setView] = useState<{ lat: number; lon: number; zoom: number } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [linkMiss, setLinkMiss] = useState(false);
  const guideAsked = useRef(false);
  const flyHomeToken = useMapStore((s) => s.flyHomeToken);
  const flyHome = useMapStore((s) => s.flyHome);
  /** 镜头请求的唯一来源：播放条点标题、分享链接，都往这里写 */
  const focus = useMapStore((s) => s.focus);
  const focusStation = useMapStore((s) => s.focusStation);
  const searchFocusToken = useMapStore((s) => s.searchFocusToken);
  /** 分享链接点名的台；读一次就定，后续 URL 变化不重新解析 */
  const deepId = useMemo(() => readStationId(), []);
  const deepDone = useRef<string | null>(null);
  /**
   * 台名默认开着。
   *
   * 光点说明「哪里在亮」，名字说明「那里是谁」。名字一开，画面确实会从
   * 一片星空变成带注记的图，但那是这张图该有的样子——它不是壁纸。
   * 密度交给避让算法：两千个台写不下，它会挑点击量高的先占位。
   */
  const [showLabels, setShowLabels] = useState(true);

  /*
   * 特效切换。
   *
   * globe 是地图本体；切到粒子特效时地图层淡出但**不卸载**——MapLibre
   * 静止不动时几乎零 GPU 开销，而卸了重挂要重新走一遍「建图 → 字体 →
   * 陆地 → 粒子 → 定尺寸」，切回来至少白屏一秒。CSS 交叉淡入淡出
   * （reduced-motion 直接硬切），两层同时在场，靠 opacity 分谁在上。
   */
  const fxId = useFxStore((s) => s.fxId);
  const fxActive = fxId !== "globe";
  /*
   * 特效层「在场」标记：进场立即挂载（淡入需要它在 DOM 里），退场要等
   * 淡出播完再摘——立刻卸载会让淡出动画跳变成硬切。reduced-motion 时
   * 过渡时长是 0，直接同步翻转即可。
   */
  const [fxMounted, setFxMounted] = useState(fxActive);
  useEffect(() => {
    if (fxActive) {
      setFxMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setFxMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setFxMounted(false), 720);
    return () => window.clearTimeout(timer);
  }, [fxActive]);

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
    // 分享链接点名了某个台：别用一张欢迎卡盖住它
    if (readStationId() && !isGuideForced()) return;
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

  const flyToStation = useCallback(
    (station: Station) => {
      if (station.geo) focusStation(station.geo);
    },
    [focusStation],
  );

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
      // 分享链接点名了台，就别让「随机点亮」把它顶掉
      if (action === "random" && !deepId) randomOnMap();
    },
    [randomOnMap, deepId],
  );

  /*
   * 分享链接：?s=<stationId>
   *
   * 时序上有三道闸门：core 数据到齐（否则查不到台）、deepDone（StrictMode
   * 与 rest 合并都会让 effect 重跑，只处理一次）、以及 WorldMap 内部的
   * worldSized（镜头复位完成后才允许飞）。
   *
   * 播放用 store 的 play 而不是 playStation：后者对同一台是 toggle，
   * 而 App 侧已经跳过了 lastStation 恢复，这里再 toggle 就会「播了又停」。
   */
  useEffect(() => {
    if (!deepId || !data || deepDone.current === deepId) return;
    deepDone.current = deepId;

    const local = data.byId.get(deepId);
    if (local) {
      if (usePlayer.getState().station?.id !== local.id) play(local, data.stations);
      if (local.geo) focusStation(local.geo);
      return;
    }

    // 有坐标的台都在 core/rest 里，本地找不到才去翻无坐标目录（只能播、不能飞）
    void loadMapCatalog()
      .then((catalog) => {
        const hit = catalog.find((s) => s.id === deepId);
        if (!hit) {
          setLinkMiss(true);
          return;
        }
        if (usePlayer.getState().station?.id !== hit.id) play(hit, catalog);
      })
      .catch(() => setLinkMiss(true));
  }, [deepId, data, play, focusStation]);

  useEffect(() => {
    if (!linkMiss) return;
    const timer = window.setTimeout(() => setLinkMiss(false), 4000);
    return () => window.clearTimeout(timer);
  }, [linkMiss]);

  /* 「/」在抽屉关着时也能直接进搜索：先开抽屉，由抽屉把焦点送进输入框 */
  useEffect(() => {
    if (searchFocusToken === 0) return;
    setDrawerOpen(true);
  }, [searchFocusToken]);

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

      {/*
       * 地球层：MapLibre 球体 + 它的太空氛围（星云/星空/明暗/暗角）。
       * 切到粒子特效时整层淡出但保持挂载——地图不卸载，切回秒出。
       */}
      <div
        className={`fx-layer ${fxActive ? "fx-layer-hidden" : "fx-layer-active"}`}
        aria-hidden={fxActive}
      >
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
      </div>

      {/*
       * 粒子特效层：fxId 是 globe 时不挂载（地球模式没有这层）。
       * 地图与特效互斥：特效在场时整层接住点击，指针事件不会落到地图上。
       */}
      {fxMounted && (
        <div className={`fx-layer ${fxActive ? "fx-layer-active" : "fx-layer-hidden"}`}>
          <Suspense fallback={null}>
            <FxScene stations={stations} onSelect={handleMapSelect} onMultiSelect={handleMultiSelect} />
          </Suspense>
        </div>
      )}

      {/* 四角角标 + 经纬度读数 */}
      <Hud view={fxActive ? null : view} total={stations.length} fxName={fxActive ? fxId : null} />

      {/*
       * 快捷键提示。
       *
       * 空格播放、N/P 切台、M 静音、/ 搜索都实现了，但界面上一个字都没写——
       * 不写就等于没有。放右下角版权条上方：那里本来是空的，也不压球体
       * 构图。bottom-[36px] 是版权条顶边（约 30px）再加 6px 间隙。
       */}
      <p className="num pointer-events-none absolute bottom-[36px] right-2 z-20 hidden text-[10px] tracking-[0.14em] text-dim sm:block">
        空格 播放 · N 下一台 · P 上一站 · M 静音 · / 搜索
      </p>

      {/*
       * 右上角操作：只留图标，文字交给 aria-label 和 title。
       *
       * 四个文字按钮竖排时占了整列右上角，把地图的一角压掉一大块。
       * 换成一行方形图标之后，同样的功能只占一条 32px 高的横带；
       * 图标含义对熟悉这类工具的人一眼就懂，不熟的靠 hover 提示。
       * 按钮组顶边与左上角 Header 胶囊对齐（sm:top-6 / 移动端 top-4），
       * 和中间的 HUD 读数组成一条齐平的顶部仪表带。
       */}
      <div className="pointer-events-none absolute right-2 top-3 z-20 flex items-center gap-1 sm:gap-1.5 sm:right-5 sm:top-6">
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

        <RandomExplorer stations={stations} onLocate={flyToStation} panelOpen={drawerOpen} />

        {/* 特效切换：粒子特效模式下才有电台点开关等选项 */}
        <FxSwitcher panelOpen={drawerOpen} />

        {/* 台名开关：眼睛，关掉时加一道斜线；只在地球模式有意义 */}
        {!fxActive && (
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
        )}

        {/* 回到世界：地球；粒子特效模式下没有「世界视角」可回 */}
        {!fxActive && (
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
        )}
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
        searchFocusToken={searchFocusToken}
      />

      {/* 分享链接里的台找不到：一句轻提示，四秒后自己消失，不弹窗 */}
      {linkMiss && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 -translate-y-1/2 text-center">
          <span className="num inline-block rounded-[6px] border border-line bg-base/85 px-3 py-2 text-[11px] tracking-[0.1em] text-muted">
            链接里的电台找不到了
          </span>
        </div>
      )}

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
