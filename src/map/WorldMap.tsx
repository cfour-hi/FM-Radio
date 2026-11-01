import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, Map as MlMap, Marker, setWorkerUrl } from "maplibre-gl";
/*
 * maplibre 在运行时用 new URL("./maplibre-gl-worker.mjs", import.meta.url) 找 worker，
 * 路径是拼出来的，打包器无法静态识别——生产构建里那个文件根本不会被产出，
 * 地图会停在「正在铺开地图」。所以显式交给 Vite 处理并告诉 maplibre 去哪拿。
 */
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/map.css";
import type { Station } from "../lib/types";
import { createGlobeRadiusSync } from "./globeRadius";
import { attachStationHover } from "./hoverTooltip";
import { stationsAtPoint } from "./hitTest";
import { loadGlobeDots, loadLandDots } from "../lib/landDots";
import { loadLandShape } from "../lib/landShape";
import {
  LAND_DOTS_SOURCE,
  LAND_PATTERN_NAME,
  LAND_SOURCE,
  LAYER,
  PROJECTION,
  SOURCE_ID,
  buildStyle,
  type StationGeoJson,
} from "./style";

export type Focus = { lon: number; lat: number; token: number };


type Props = {
  stations: Station[];
  /** 当前要画环的那一个（正在听或刚点开的） */
  highlightId: string | null;
  focus: Focus | null;
  /** 每 +1 就把镜头拉回整个世界 */
  resetToken: number;
  /** 台名默认开着，右上角的开关可以整层关掉 */
  showLabels: boolean;
  onSelect: (station: Station) => void;
  /** 同一处叠了多个台时回调：交给抽屉列「这一带 N 个台」 */
  onMultiSelect: (stations: Station[]) => void;
  /** 视角变化（拖动/缩放）时回调，HUD 用它显示经纬度读数 */
  onViewChange?: (view: { lat: number; lon: number; zoom: number }) => void;
  onReady: () => void;
  onFail: (reason: string) => void;
};

/** 视野经度范围：把 180 附近让开，免得正好切在日界线上 */
const WORLD_WEST = -178;
const WORLD_EAST = 178;

/** 世界视野的默认纬度中心，偏北一点：电台几乎都在北半球 */
const FOCUS_LAT = 14;

function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function invMercY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/**
 * 按容器的宽高比算出「刚好铺满」的世界范围。
 *
 * 直接 fitBounds 整张世界，在宽屏上会被高度卡住，两侧留出下一份世界副本
 * （格陵兰出现两次）。这里改成按宽度定缩放，把南北两端裁掉一点：
 * 裁掉的是南极和北极圈，本来是空的，画面反而更满。
 */
function worldBoundsFor(width: number, height: number): [[number, number], [number, number]] {
  const spanY = Math.min(1, height / Math.max(width, 1));
  const centerY = mercY(FOCUS_LAT);
  let top = centerY - spanY / 2;
  let bottom = centerY + spanY / 2;
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > 1) {
    top -= bottom - 1;
    bottom = 1;
  }
  return [
    [WORLD_WEST, invMercY(bottom)],
    [WORLD_EAST, invMercY(top)],
  ];
}

/**
 * 默认视角：中国区域。
 *
 * 原来镜头对着 [24, 22]——欧洲、非洲、中东、印度同时在线，那是按「全球
 * 点位最分散」挑的。但库里一千多个中国台、图上给中国留了 260 个落点，
 * 是全球最密的一块；打开先看到撒哈拉，等于把最该看的地方转到了背面。
 *
 * 104E / 34N 接近中国的几何中心。这只改朝向、不改缩放：球仍然是「整颗
 * 装进窗口」的大小，转过来之后中国落在正面中央，西边能看到欧洲西岸、
 * 东边到日本与东南亚，整颗球还是完整的。
 *
 * 如果要重新对到别的区域，改这一行就够——fitWorld、初始 jumpTo、窗口
 * 变化后的重排都从这里取。
 */
const DEFAULT_CENTER: [number, number] = [104, 34];

/**
 * 球体直径占容器短边的比例。留一点余量给边缘的大气辉光，球不顶到边框。
 *
 * 竖屏另给一档：宽度是限制边，84% 的球在 390 宽的手机上只有 328px，
 * 上下会空出一大片——那块空白没有任何用，而球越大，中国那一片光点
 * 越分辨得出来。手机上的辉光余量可以收紧一点，92% 仍然不贴边。
 */
const GLOBE_FILL_LANDSCAPE = 0.88;
const GLOBE_FILL_PORTRAIT = 0.92;

/** 球体该画多大：方形与横屏按高度一档，竖屏按宽度一档 */
function globeTargetDiameter(width: number, height: number): number {
  const fill = width < height ? GLOBE_FILL_PORTRAIT : GLOBE_FILL_LANDSCAPE;
  return Math.min(width, height) * fill;
}

/**
 * 「放大一档，球大多少」的经验斜率：实测 d ∝ 2^(0.88·z)。
 *
 * 后面的反解只拿它当第一步的步长，真正的答案由 measureGlobeDiameter 量出来，
 * 所以这个数字不精确也不影响结果，只影响迭代次数。
 */
const ZOOM_SLOPE = 0.88;

/**
 * 量出球体此刻在屏幕上的直径（像素）。
 *
 * 做法是沿中心经线从中心往南北各扫一遍，取「点到中心投影的最大距离」——
 * 那个最大值就是球体的轮廓半径，乘二即直径。
 *
 * 为什么不是「取一个和中心相距 90° 的点」：那是球面几何上的 90°，不是
 * 视觉上的轮廓。globe 是透视投影，相机离球心只有三四个球半径，真正的
 * 轮廓出现在约 74° 处；90° 那个点已经翻到背面去了，投影落在轮廓圆内侧
 * 4–5%，拿它当半径会解出一个偏大的球。
 *
 * 这个偏差在镜头对着赤道时看不太出来，换个高纬度就露馅：中心挪到 34°N
 * 之后，整颗球直接撑出容器上下边——所以改成扫描取最大值，和经纬度无关。
 *
 * 为什么不再用「直径/容器高 = 0.0874 + 0.4433·zoom」那条直线：
 * 那是拿 535px 高的面板量出来的，换成整屏（811px 高、1600 宽）之后，
 * 同一个 zoom 下球反而更小——MapLibre 的球体像素大小同时受视口宽高影响。
 * 量出来再反解，换多少尺寸都对。
 */
function measureGlobeDiameter(map: MlMap): number {
  const center = map.getCenter();
  const middle = map.project([center.lng, center.lat]);
  let radius = 0;
  /*
   * 3° 一档。轮廓附近这条曲线很平（±3° 只差半个像素），没必要扫得更细；
   * 往南北两边都扫，是因为高纬度上单向扫可能到不了 90° 弧长——两极附近
   * 会被 85° 的纬度上限截住。
   */
  for (let offset = 3; offset <= 180; offset += 3) {
    for (const sign of [-1, 1]) {
      const lat = Math.max(-85, Math.min(85, center.lat + sign * offset));
      const point = map.project([center.lng, lat]);
      radius = Math.max(radius, Math.hypot(point.x - middle.x, point.y - middle.y));
    }
  }
  return radius * 2;
}

/**
 * 反解一个让球体直径等于 target 的缩放。
 *
 * 每次迭代用当前实测直径算误差，再按斜率折算成缩放差。三到四次就收敛，
 * 而且每一步都是同步的（jumpTo 立即改 transform），不会让用户看到中间态。
 */
function solveGlobeZoom(map: MlMap, target: number): number {
  let zoom = map.getZoom();
  for (let i = 0; i < 4; i += 1) {
    const diameter = measureGlobeDiameter(map);
    if (!(diameter > 0)) break;
    const step = Math.log2(target / diameter) / ZOOM_SLOPE;
    if (Math.abs(step) < 0.008) break;
    zoom = Math.min(3, Math.max(0.4, zoom + step));
    map.jumpTo({ zoom });
  }
  return map.getZoom();
}

setWorkerUrl(mapWorkerUrl);

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** WebGL 是硬门槛：没有它 MapLibre 会在构造函数里直接抛错 */
function hasWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * 标签文字的截断。
 *
 * 众包台名里有相当一部分把流派、年代、频段全塞进名字（"0R - 90s Pop, 90s Hits,
 * Eurodance, Hip Hop, R&B, Grunge…"）。这种东西在窄屏上会换行成十几行，
 * 一块屏幕被一个标签占满。MapLibre 的 text-max-width 只管宽度不管行数，
 * 所以只能在数据侧截断。
 *
 * 截断不影响识别：选中之后卡片里显示的是完整台名。
 */
function labelOf(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 20) return name.trim();
  return `${chars.slice(0, 20).join("").trimEnd()}…`;
}

function toGeoJson(stations: Station[]): StationGeoJson {
  const features: StationGeoJson["features"] = [];
  for (const station of stations) {
    if (!station.geo) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.geo.lon, station.geo.lat] },
      properties: {
        sid: station.id,
        clicks: station.clicks,
        // 标签直接用台名。全球视角下能写出来的本来就没几个，写出来的
        // 应该是「这里有什么台」，而不是「这里是哪个省」。
        name: labelOf(station.name),
        state: station.state ?? "",
        // 推断坐标打标，样式里据此分「实心暖色 / 空心冷色」两层
        approx: station.geoApprox ? 1 : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * 生成陆地微观纹理（D 方案）。
 *
 * SVG data URI 走 map.loadImage 会被 createImageBitmap 路径拒掉，所以改在
 * 这里用 canvas 现画一张 32×32 的无缝菱形网格：45° 斜线交叉、交点落一颗
 * 冷色小点。四角的点画到边缘，平铺时相邻 tile 各出一半合成完整点，自然无缝。
 */
function makeLandPattern(): ImageData {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // 45° 斜线（跨角，平铺后连续成菱形网格）
  ctx.strokeStyle = "rgba(111, 179, 210, 0.32)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(S, S);
  ctx.moveTo(S, 0);
  ctx.lineTo(0, S);
  ctx.stroke();

  // 顶点：四角 + 中心（角上的半圆平铺后合成完整点）
  ctx.fillStyle = "rgba(111, 179, 210, 0.45)";
  const pts: [number, number][] = [
    [0, 0],
    [S, 0],
    [0, S],
    [S, S],
    [S / 2, S / 2],
  ];
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, S, S);
}

function WorldMap({
  stations,
  highlightId,
  focus,
  resetToken,
  showLabels,
  onSelect,
  onMultiSelect,
  onViewChange,
  onReady,
  onFail,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * 世界视角定尺寸完成了没有。
   *
   * 建好地图后第一次 idle 会 fitWorld(false) 把镜头摆回整球；在这之前
   * 任何 flyTo 都会被那一次复位覆盖掉（表现是「飞到一半又回去了」）。
   * 飞行动作要等这个闸门。
   */
  const [worldSized, setWorldSized] = useState(false);

  const geo = useMemo(() => toGeoJson(stations), [stations]);
  const appliedGeoRef = useRef<StationGeoJson | null>(null);
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  // 初始化时读一次就够，后续变化不会重建地图
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const multiRef = useRef(onMultiSelect);
  multiRef.current = onMultiSelect;
  const viewRef = useRef(onViewChange);
  viewRef.current = onViewChange;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!hasWebgl()) {
      failRef.current("这台设备的浏览器没有开启 WebGL，地图画不出来");
      return;
    }

    let map: MlMap;
    try {
      map = new MlMap({
        container,
        style: buildStyle(geoRef.current),
        center: DEFAULT_CENTER,
        /*
         * 初始缩放只是个起点，真正的尺寸在 fitWorld 里量出来再反解。
         * 1.6 是「球大约占半屏」的粗估值——放这里只是为了避免第一帧
         * 出现一个明显过大或过小的球。
         */
        zoom: PROJECTION === "globe" ? 1.6 : 1.1,
        minZoom: 0.6,
        maxZoom: 9,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchZoomRotate: true,
        fadeDuration: 120,
        /*
         * 中文现画，不走字形文件。
         *
         * 地图上的文字只有一种：放大后的电台名。台名中西混杂，而自托管的
         * FMRadio.pbf 只切了 0–255 这一段（数字和拉丁字母）。让 MapLibre
         * 用系统字体去画 CJK，就不用为一个标签层背上几十 MB 的中文子集化字体；
         * 拉丁字符仍然走 PBF，两边在同一个 symbol 层里自动分工。
         */
        localIdeographFontFamily:
          "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
      });
    } catch {
      failRef.current("地图初始化失败");
      return;
    }

    appliedGeoRef.current = geoRef.current;
    mapRef.current = map;
    /*
     * 不再渲染任何在线底图，所以这里不需要瓦片归属。
     * 陆地轮廓仍然该注明出处：Natural Earth 是公有领域，署名不是义务，
     * 但一张只有陆地的图上，那唯一的地理信息来自谁，应该说得清楚。
     */
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: "陆地轮廓 © Natural Earth" }),
      "bottom-right",
    );

    /*
     * 大气层。globe 下 MapLibre 用它渲染球体边缘外的一圈辉光。
     *
     * 没有它，球的边缘会直接融进太空——尤其海洋那一侧，整颗球看起来
     * 像一张剪成圆的贴图而不是立体的球。有这层辉光之后轮廓自己就浮出来了，
     * 不用再给球描边。
     *
     * 整屏之后这圈光比过去更重要，也更亮。原先地图只有 535px 高、外面还套着
     * 一圈面板边框，球的轮廓由边框代劳了一半；现在球占了整个窗口，四周全是
     * 黑的，辉光要是还压在那个亮度，球就只剩一个由粒子拼出来的剪影。
     *     horizon 从 #1b2e3d 提到 #5496bb，atmosphere-blend 提到 1：
     * 亮的是「贴着球的那一圈」，太空一侧仍然是黑的，所以不会变成发光玩具。
     *
     * 必须等样式就绪再调，否则会抛 "Style is not done loading"，
     * 而这个异常会把整个初始化流程打断——地图直接白屏。
     */
    if (PROJECTION === "globe") {
      /*
       * 大气层只在球体模式下有意义。MapLibre 从 globe 过渡到 mercator 之后
       * 并不会自动把它收干净，平面上会残留一圈由外向内的暗角。
       * 所以按缩放手动开关：3.6 以下保持，之上直接归零。
       *
       * skyOn 用 null 表示「还没设成功过」。
       *
       * 这一条是踩出来的：建图时会先把镜头跳到世界视角，那一次 zoom 事件
       * 在样式加载完之前就来了，setSky 静默不生效；如果那时就把天空记成
       * 「已打开」，等 load 再调就会被守卫挡掉，整颗球永远少一圈光。
       * 所以只有真正设成功才置位，load 时再强制来一次。
       */
      let skyOn: boolean | null = null;
      const applySky = (on: boolean) => {
        const before = skyOn;
        skyOn = on;
        try {
          map.setSky({
            /*
             * 太空。比海面（style.ts 的 INK.sea #0a1019）再压暗两档：
             * 这两块颜色现在是分开的——background 只画在球面上，球外面
             * 是天空。差值足够大，球才是一颗球而不是一块深色底。
             */
            "sky-color": "#04060b",
            "horizon-color": "#5496bb",
            /*
             * 雾色和站点底色一致（--color-base）。fog 不只在球体边缘起作用，
             * 平面模式下它也会压在画面四周——用别的颜色当雾色，放大后的地图
             * 会多出一圈不该有的暗角。
             */
            "fog-color": "#08090c",
            "sky-horizon-blend": 0.9,
            "atmosphere-blend": on ? 1 : 0,
          });
        } catch {
          // 样式还没就绪，撤销置位，下一次事件再试
          skyOn = before;
        }
      };
      const syncSky = () => {
        const want = map.getZoom() < 3.6;
        if (want === skyOn) return;
        applySky(want);
      };

      // load 之后不管守卫，先实打实地设一次
      map.once("load", () => {
        skyOn = null;
        syncSky();
      });
      map.on("zoom", syncSky);
    }

    /*
     * 边缘压暗 + 球体明暗随缩放调整。
     *
     * vignette 原本是给暗色 2D 地图做「面板感」的，全球视角下它把球体
     * 和页面边界揉得很自然；放大之后画面里只剩台点和台名，暗角会直接
     * 啃掉贴边的标签，所以继续退场。
     *
     * shading 是球体明暗（伪光照），只在 globe 状态有意义：z≥3.6 球就
     * 开始过渡到平面，到 4.6 完全平坦，此时左上高光/右下阴影就成了一个
     * 不该有的亮斑和暗斑，所以跟着一起退场，节奏比 vignette 略快。
     */
    const shell = map.getContainer().closest<HTMLElement>(".map-shell");
    let vignette = -1;
    let shading = -1;

    /*
     * 星空 / 星云的圆形镂空半径。
     *
     * 球体在屏幕上的半径不是常量：往回收一档它变小，往前推一档它撑出视口。
     * 而星空层的遮罩必须正好挖掉球体那一块——半径偏大，球外面就露出一圈
     * 「一个星星都没有的大圆」；半径偏小，星星直接压在球面上。
     *
     * 过去这个值只在 fitWorld 里按目标尺寸写一次，全球视角下刚好对得上，
     * 一缩放就全歪了。所以改成每次缩放都重量一次：量的是球体此刻真实的
     * 轮廓半径，不是任何公式。
     */
    let globeRadius = -1;
    const setGlobeRadius = (radius: number) => {
      if (!Number.isFinite(radius) || radius < 24) return;
      const next = Math.round(radius);
      if (next === globeRadius) return;
      globeRadius = next;
      shell?.style.setProperty("--globe-r", `${next}px`);
    };
    const radiusSync = createGlobeRadiusSync(() => measureGlobeDiameter(map) / 2, setGlobeRadius);
    const syncGlobeRadius = () => {
      radiusSync.sync(map.getZoom(), PROJECTION === "globe" && shading > 0);
    };

    const syncOverlays = () => {
      const zoom = map.getZoom();
      const vigNext =
        Math.round((zoom <= 3.2 ? 0.55 : zoom >= 4.8 ? 0 : (0.55 * (4.8 - zoom)) / 1.6) * 100) / 100;
      if (vigNext !== vignette) {
        vignette = vigNext;
        shell?.style.setProperty("--map-vignette", String(vigNext));
      }
      const shadeNext =
        Math.round((zoom <= 3.2 ? 1 : zoom >= 4.6 ? 0 : (4.6 - zoom) / 1.4) * 100) / 100;
      if (shadeNext !== shading) {
        shading = shadeNext;
        shell?.style.setProperty("--map-shading", String(shadeNext));
        /*
         * 星空和球体明暗同进退：放大到 globe→mercator 过渡之后，球铺满屏幕，
         * 「球外太空」这个概念就不存在了，星星继续留在原地只会压在平面地图上。
         */
        shell?.style.setProperty("--map-stars", String(shadeNext));
      }

      /*
       * 镂空半径跟着这一次缩放走。
       *
       * 放在这里而不是 fitWorld：缩放是连续发生的（滚轮、双指、flyTo，
       * 每帧都会发 zoom 事件），而 fitWorld 只在窗口尺寸变化和被叫回
       * 世界视角时跑一次。遮罩要对齐的是「现在屏幕上的球」，不是「上次
       * 布局时的球」。
       */
      syncGlobeRadius();
    };
    map.once("load", syncOverlays);
    map.on("zoom", syncOverlays);

    // HUD 读数：拖动/缩放都触发，节流到 100ms，别让每个像素都重渲染一遍 React
    let viewTimer = 0;
    const emitView = () => {
      viewRef.current?.({ lat: map.getCenter().lat, lon: map.getCenter().lng, zoom: map.getZoom() });
    };
    map.on("move", () => {
      if (viewTimer) return;
      viewTimer = window.setTimeout(() => {
        viewTimer = 0;
        emitView();
      }, 100);
    });

    // 端到端测试要按屏幕坐标点地图上的点，和 __player 一样只在开发期暴露
    if (import.meta.env.DEV) {
      (window as unknown as { __map?: MlMap }).__map = map;
    }

    /**
     * 世界视角的缩放值。
     *
     * 两个用途：一是「回到世界」的落点——从城市级飞回来时不能现量（相机
     * 贴得太近，量出来的不是球体直径）；二是判断窗口尺寸变化之后，镜头
     * 还停不停止在世界视角。
     */
    let worldZoom = map.getZoom();

    const fitWorld = (animate: boolean) => {
      const { clientWidth, clientHeight } = map.getContainer();
      if (PROJECTION === "mercator") {
        /*
         * 平面模式下这条仍是「以 0° 经线居中」的整幅世界——fitBounds 的
         * 东西边界必须落在 ±180 以内，没法把视野中心挪到 104E 去。
         * 现在用的是 globe，所以不影响默认视角；真要切回平面，这里得
         * 另想一个平移方案。
         */
        map.fitBounds(worldBoundsFor(clientWidth, clientHeight), {
          padding: 0,
          duration: animate && !prefersReducedMotion() ? 700 : 0,
        });
        return;
      }

      /*
       * globe 下不能用 fitBounds：它会把经纬度范围填满视口，而球体的
       * 视觉边界比经纬度范围大得多（正面只显示 180°，球却要占满整个屏幕），
       * 结果就是球被上下切掉。改成先量出当前直径，再反解一个刚好装得下的缩放。
       *
       * 朝向固定回 DEFAULT_CENTER：这个方法同时是初始视角和「回到世界」
       * 的实现，重置之后应该回到打开页面时的样子——整颗球、中国在正面中央，
       * 而不是一颗仍然对着刚才那个城市的球。
       */
      const target = globeTargetDiameter(clientWidth, clientHeight);
      /*
       * 先按目标尺寸写一个近似值，让星空遮罩在求解收敛之前就大致对齐；
       * 真正的半径由 syncGlobeRadius 在每一次 zoom 之后量出来覆盖掉。
       */
      setGlobeRadius(target / 2);
      // 让下一次 zoom 事件强制重量（不信任这颗近似值）
      radiusSync.invalidate();

      if (animate && !prefersReducedMotion()) {
        /*
         * 飞回来的落点用 worldZoom，不现量。
         *
         * 量直径的前提是镜头正对着整颗球。站在城市级缩放上，相机离地只有
         * 几个街区，project() 投出来的「直径」是两千多像素的胡话，拿它反解
         * 会让球大出 7%。
         *
         * 所以先按上次的落点飞回去，落地后再精确校一次——那时镜头已经回到
         * 整球，量出来才是真的。用户若在飞行途中插手，就不再校正。
         */
        map.easeTo({ center: DEFAULT_CENTER, zoom: worldZoom, duration: 700 });
        map.once("moveend", () => {
          if (Math.abs(map.getZoom() - worldZoom) > 0.25) return;
          map.jumpTo({ center: DEFAULT_CENTER, zoom: solveGlobeZoom(map, target) });
          worldZoom = map.getZoom();
        });
        return;
      }

      /*
       * 同步版：先把镜头摆回整球附近再量。
       *
       * 两次 jumpTo 在同一帧里完成，中间态不会被渲染出来，用户只看到落地。
       */
      if (map.getZoom() > 2.6) map.jumpTo({ center: DEFAULT_CENTER, zoom: 2 });
      map.jumpTo({ center: DEFAULT_CENTER, zoom: solveGlobeZoom(map, target) });
      worldZoom = map.getZoom();
    };

    /*
     * 尺寸不在这里定。
     *
     * 建图这一刻 globe 的相机还没就位：实测 map.getCenter() 仍是赤道、
     * project() 出来的轮廓半径也偏小四分之一。拿这个数去反解，解出来的
     * 缩放会大 15%——球直接顶出容器上下边。
     *
     * 真正的定尺寸放在第一次 idle（见下面的 map.once("idle")）：那时样式、
     * 相机、画布尺寸都已落定，量出来的直径和帧缓冲里的像素一致。
     */

    // 地图销毁后，还在路上的粒子和飞行动画都不该再碰这个实例
    let alive = true;

    /*
     * D 方案：陆地微观纹理。
     *
     * fill 层在样式里用 fill-pattern 引用了 LAND_PATTERN_NAME，但这个
     * image 得由 addImage 显式注册。图案用 canvas 现画——SVG data URI 走
     * loadImage 会被 createImageBitmap 路径拒掉；pixelRatio 2 保证高分屏
     * 不发虚。注册后 MapLibre 会自动重绘陆地面。
     */
    try {
      if (!map.hasImage(LAND_PATTERN_NAME)) {
        map.addImage(LAND_PATTERN_NAME, makeLandPattern(), { pixelRatio: 2 });
      }
    } catch {
      /* 图案注册失败不影响出图：陆地面退回纯色 */
    }

    map.on("load", () => {
      setLoaded(true);

      /*
       * 第一次 idle 才定尺寸，也才告诉页面「可以看了」。
       *
       * idle 意味着样式、相机、画布都已经落定并且画完了一帧；在它之前量
       * 出来的球体直径是错的（见上面的注释）。把 onReady 也挪到这里，
       * 加载遮罩就一直盖着，用户不会看到「先小后大」的那一下跳动。
       */
      map.once("idle", () => {
        if (!alive) return;
        fitWorld(false);
        // 尺寸落定，飞行动作从这一刻起才允许覆盖镜头
        setWorldSized(true);
        readyRef.current();
      });

      /*
       * 陆地与粒子都是「取不到也照常出图」的层，各自独立加载、互不等待。
       * 陆地面塌了球体会薄一点，粒子塌了少一层质感，都不该挡住地图本身。
       */
      void loadLandShape().then((land) => {
        if (!alive || !land) return;
        try {
          (map.getSource(LAND_SOURCE) as GeoJSONSource | undefined)?.setData(land);
        } catch {
          /* 地图刚好在这一帧被销毁了，忽略 */
        }
      });

      const loadDots = PROJECTION === "globe" ? loadGlobeDots : loadLandDots;
      void loadDots().then((dots) => {
        if (!alive || !dots) return;
        try {
          (map.getSource(LAND_DOTS_SOURCE) as GeoJSONSource | undefined)?.setData(dots);

          /*
           * C 方案：冷暖双色粒子。
           *
           * 主粒子（暖金）由样式里的 glow + 内芯两层负责。这里再从同一批
           * 点里抽样三分之一，铺一层更小、更暗的冷色点，混在暖色粒子里——
           * 让「发光的地表」带上数据感的冷色颗粒，和推断电台点的冷色环呼应。
           * 冷色点更稀疏、更淡，只作底纹的「噪点」，不抢暖粒子的主体。
           */
          const mp = dots.features[0]?.geometry;
          if (mp?.type === "MultiPoint" && !map.getSource("land-dots-cold")) {
            const picked: [number, number][] = [];
            for (let i = 0; i < mp.coordinates.length; i += 3) {
              picked.push(mp.coordinates[i] as [number, number]);
            }
            if (picked.length > 0) {
              map.addSource("land-dots-cold", {
                type: "geojson",
                data: {
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      geometry: { type: "MultiPoint", coordinates: picked },
                      properties: {},
                    },
                  ],
                },
              });
              map.addLayer(
                {
                  id: "land-dots-cold",
                  type: "circle",
                  source: "land-dots-cold",
                  maxzoom: 5,
                  paint: {
                    "circle-color": "#5aa9c9",
                    "circle-radius": 0.7,
                    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 3, 0.22, 3.8, 0.08, 4.6, 0],
                  },
                },
                LAYER.dot,
              );
            }
          }
        } catch {
          /* 同上 */
        }
      });
    });

    // 直接把 fitWorld 挂到 map 上给「回到世界」用
    mapRef.current = map;
    (map as MlMap & { fitWorld?: (animate: boolean) => void }).fitWorld = fitWorld;

    /*
     * 窗口尺寸变了，球也得跟着重算。
     *
     * 从前地图是个固定高度的方块，宽度变化只会让两侧多出空白，不至于出错，
     * 所以没人在意。改成整屏之后，容器宽高会随窗口、随手机横竖屏变化，
     * 而球体的尺寸也正是从这两个数反解出来的——不重算球就偏大或偏小。
     *
     * 挂在 map 的 resize 上，不是 window 的：MapLibre 要先按新尺寸重排
     * 画布，这里量到的宽高才是新的。听 window 的 resize 会早一帧——
     * 量到的还是旧容器，算出来的球会比该有的小一圈。
     *
     * 只在「镜头还停在世界视角」时重算：用户已经飞进某个城市了，
     * 这时候改缩放等于把他刚才的操作撤掉。
     */
    const onResize = () => {
      radiusSync.invalidate();
      if (Math.abs(map.getZoom() - worldZoom) <= 0.25) fitWorld(false);
      // 非世界视角也需要按新画布尺寸校准遮罩，但不改变用户视角。
      syncOverlays();
    };
    map.on("resize", onResize);

    /*
     * 点击：台名优先于光点。
     *
     * 名字默认打开之后，人会先去点名字。而命中层的半径是 14px——华北一带
     * 两个台常常只隔几个像素，直接查命中层会选中旁边那个，名字和选中的台
     * 对不上，比点不中更让人困惑。
     *
     * 标签的命中框就是文字本身，很窄，所以先查它；没命中再退回光点。
     * 标签隐藏时这一层查不到东西，自然跳过。
     *
     * 同一个点叠了多个台（大城市的推断点密集）时不再取第一个：去重后
     * 如果不止一个，回调 onMultiSelect 让抽屉列「这一带 N 个台」，
     * 否则照旧单选。取 [0] 会让其余台在交互上不存在。
     */
    map.on("click", (event) => {
      // 命中的判定与悬停提示共用一份，免得「提示的是 A、点开的却是 B」
      const hit = stationsAtPoint(map, event.point, byIdRef.current);
      if (hit.stations.length === 0) return;
      if (hit.stations.length === 1) selectRef.current(hit.stations[0]!);
      else multiRef.current(hit.stations);
    });

    /*
     * 悬停提示与 cursor 都归它管：命中台才变手型，拖拽期间不写 cursor
     * （写了会压住 MapLibre 自己的 grabbing）。
     */
    const detachHover = attachStationHover(map, { byId: () => byIdRef.current });

    /*
     * 矢量数据偶发解析失败、WebGL 上下文丢失都会走这里。这类事件是常态，
     * 不能当成致命错误弹给用户——真的画不出来时 onFail 会先被调用。
     */
    map.on("error", (event) => {
      if (import.meta.env.DEV) console.debug("[map]", event.error?.message ?? event);
    });

    return () => {
      alive = false;
      if (viewTimer) window.clearTimeout(viewTimer);
      // 提示条挂在容器上，map.remove() 不会顺手带走它
      detachHover();
      map.off("resize", onResize);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      setLoaded(false);
      setWorldSized(false);
    };
  }, []);

  // 后续分片到达时只更新 source；首屏已在 style 中提供，避免重复送进 worker。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || appliedGeoRef.current === geo) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(geo);
    appliedGeoRef.current = geo;
  }, [geo, loaded]);

  /*
   * 台名开关。图层在样式里默认是可见的，这里只负责「关掉 / 再打开」。
   *
   * 用 setLayoutProperty 而不是改样式重建：symbol 层的避让状态是 MapLibre
   * 自己缓存的，重建样式会把镜头、已经飞到的位置全丢掉。
   *
   * 依赖里带着 loaded：首帧样式还没就绪时 setLayoutProperty 会抛错，
   * 等 load 完这个 effect 再跑一次，把初始状态（打开）落实下去。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    try {
      map.setLayoutProperty(LAYER.label, "visibility", showLabels ? "visible" : "none");
    } catch {
      /* 样式刚好在重建，下一帧这个 effect 还会再跑 */
    }
  }, [showLabels, loaded]);

  /*
   * 选中环用 DOM 标记，而不是地图图层。
   * 图层方案要么被后加的标签压住，要么得为它单独算层级；而这个环只需要
   * 稳稳待在「选中的是哪一个」这一点上。Marker 跟着投影走，球体旋转时
   * 会自己跑到背面藏起来，正好是想要的行为。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const station = highlightId ? byId.get(highlightId) : null;

    /*
     * 每次都重建 marker，不复用旧的。
     *
     * 复用只能 setLngLat，而扩散动画是 CSS 的无限循环——换台之后环不会
     * 重新从零扩一次，用户会以为「点了没反应」。更糟的是同城的推断台可能
     * 落在同一坐标，setLngLat 完全无变化，环就永远停在上一轮的末态。
     * 代价只是每切一次台多创建一个 div。
     */
    markerRef.current?.remove();
    markerRef.current = null;
    if (!station?.geo) return;

    const el = document.createElement("div");
    el.className = "map-ping";
    el.dataset.sid = station.id; // 端到端断言用
    el.setAttribute("aria-hidden", "true");
    const ring = document.createElement("span");
    ring.className = "map-ping-ring";
    const core = document.createElement("span");
    core.className = "map-ping-core";
    el.append(ring, core);

    markerRef.current = new Marker({ element: el, anchor: "center" })
      .setLngLat([station.geo.lon, station.geo.lat])
      .addTo(map);
  }, [highlightId, loaded, byId]);

  // 飞过去
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !worldSized) return;
    /*
     * 停在 4.8 而不是更近。
     *
     * 点开一个台时，用户想知道的往往不只是「这一个在哪」，还有「这一带还有
     * 哪些台」——标签默认关着，视野太紧就只剩孤零零一个光点了。4.8 这个
     * 尺度大约是一两个省，周围的光点刚好能一起进画。
     */
    map.flyTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(map.getZoom(), 4.8),
      duration: prefersReducedMotion() ? 0 : 900,
      essential: true,
    });
  }, [focus, worldSized]);

  // 回到整个世界
  useEffect(() => {
    const map = mapRef.current as (MlMap & { fitWorld?: (animate: boolean) => void }) | null;
    if (!map || !loaded || resetToken === 0) return;
    map.fitWorld?.(true);
  }, [resetToken, loaded]);

  /*
   * 地图容器必须是「有确定高度」的普通 div，不能自己带 absolute。
   * MapLibre 会往这个 div 上加 .maplibregl-map，其中 position: relative 的
   * 优先级与 Tailwind 的 .absolute 相同但后加载，会把定位覆盖掉——
   * 于是 absolute + inset 变成对 relative 元素无效，高度塌成 0，
   * 画布退回默认 400×300，地图看起来一片黑。
   */
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export default memo(WorldMap);
