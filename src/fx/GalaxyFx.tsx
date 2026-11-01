import { useMemo, useRef } from "react";
import type { Station } from "../lib/types";
import { selectStationDots, useFxStationPick, type StationDotSeed } from "./dots";
import { useFxCanvas, type FxFrame } from "./useFxCanvas";
/*
 * 银河旋臂粒子星系。
 *
 * 视觉结构：
 *   - 核球：中心一小团偏暖的密集粒子，银河系最亮的地方
 *   - 旋臂：两条对数螺旋，粒子密度沿臂指数衰减，臂外是稀疏的盘面散点
 *   - 电台点：有坐标的台映射到盘面上（经度 → 角度、纬度 → 半径），
 *     暖金色是真实坐标、冷色是推断坐标——和地球模式「冷暖双色」同一个隐喻
 *   - 正在播的台：一圈向外扩散的脉冲环（对应地图上的 .map-ping）
 *
 * 旋转用差速：内圈快、外圈慢，整体节奏压到约 90 秒一圈——它是壁纸，
 * 不是演示动画，动得太快三秒钟就看腻了。
 */

/** 半径 0 处的角速度（弧度/秒）；半径 1 处按 DISK_SHEAR 收窄到 45% */
const CORE_SPIN = (Math.PI * 2) / 90;
const DISK_SHEAR = 0.55;

/** 星系里程序化粒子的数量。Canvas 2D 每帧画两千多个小圆仍有余裕 */
const STAR_COUNT = 2200;

type GalaxyStar = {
  /** 0–1，到盘心的距离（盘半径 = 短边的 0.46 倍） */
  r: number;
  /** 初始方位角 */
  a: number;
  /** 像素半径基准值 */
  size: number;
  alpha: number;
  /** [r, g, b] */
  color: [number, number, number];
  /** 闪烁相位 */
  tw: number;
};

type GalaxyDot = StationDotSeed & {
  /** 屏幕坐标，每帧随旋转更新；点击命中读的是最近一帧的落点 */
  x: number;
  y: number;
  /** 归一化盘半径 / 方位角，与背景星同一条旋转公式 */
  r: number;
  a: number;
};

/** 电台 → 盘面坐标的映射。 */
function stationPolar(lon: number, lat: number): { r: number; a: number } {
  return {
    r: Math.min(0.97, Math.max(0.08, (90 - lat) / 180)),
    a: (lon * Math.PI) / 180,
  };
}

/** 冷暖双色收在 dots.ts：真实坐标暖金、推断坐标冷蓝，与地图一致 */

function buildDots(stations: Station[]): GalaxyDot[] {
  return selectStationDots(stations).map((seed) => {
    const { r, a } = stationPolar(seed.lon, seed.lat);
    return { ...seed, x: 0, y: 0, r, a };
  });
}

export type GalaxyFxProps = {
  stations: Station[];
  /** 正在播的台：画脉冲环；null 则不画 */
  liveId: string | null;
  /** showStations=false 时只出星系，不画不响应电台点 */
  showStations: boolean;
  /** 命中的台列表（按离点击点距离排序）交给上层；上层决定单选还是弹列表 */
  onPickStations: (picked: Station[]) => void;
};

export default function GalaxyFx({ stations, liveId, showStations, onPickStations }: GalaxyFxProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /*
   * 电台列表在特效存活期间会变（rest 分片到齐、切台），重建点表用
   * useMemo 就够；程序化星系只依赖尺寸，放在 build 里按需重建。
   */
  const dots = useMemo(() => buildDots(stations), [stations]);
  const dotsRef = useRef<GalaxyDot[]>(dots);
  dotsRef.current = dots;
  const liveRef = useRef<string | null>(liveId);
  liveRef.current = liveId;
  const showRef = useRef(showStations);
  showRef.current = showStations;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  /*
   * 点击命中：电台点的落点每帧都记在 dot.x/dot.y 里，直接量距离最可靠。
   * 14px 与地图 hitTest 的命中半径一致（见 dots.ts）。
   */
  const handleClick = useFxStationPick(canvasRef, dotsRef, stationsRef, showRef, onPickStations);

  const runtime = useRef<{ stars: GalaxyStar[]; w: number; h: number }>({ stars: [], w: 0, h: 0 });

  const build = (width: number, height: number) => {
    runtime.current = { stars: buildGalaxy(width, height, STAR_COUNT), w: width, h: height };
  };

  const draw = (frame: FxFrame) => {
    const { ctx, width, height } = frame;
    ctx.clearRect(0, 0, width, height);
    const { stars } = runtime.current;
    if (stars.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    const disk = Math.min(width, height) * 0.46;

    /*
     * 差速旋转：直接在粒子自己的极坐标里加一个随半径衰减的相位偏移，
     * 一次 sin/cos 出坐标，不用碰 canvas 变换栈。
     */
    for (const star of stars) {
      const spin = star.a + frame.time * CORE_SPIN * (1 - star.r * DISK_SHEAR);
      const x = cx + Math.cos(spin) * star.r * disk;
      const y = cy + Math.sin(spin) * star.r * disk;
      // 闪烁：alpha 叠一个慢正弦，深浅不一才像活的东西
      const twinkle = 0.82 + 0.18 * Math.sin(frame.time * 0.7 + star.tw);
      ctx.fillStyle = `rgba(${star.color[0]},${star.color[1]},${star.color[2]},${(star.alpha * twinkle).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 核球：两层径向渐变的暖光，别让中心变成一颗死白点
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, disk * 0.3);
    core.addColorStop(0, "rgba(255, 224, 168, 0.5)");
    core.addColorStop(0.45, "rgba(224, 164, 96, 0.16)");
    core.addColorStop(1, "rgba(224, 164, 96, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, disk * 0.3, 0, Math.PI * 2);
    ctx.fill();

    const show = showRef.current;
    const live = liveRef.current;

    // 电台点：垫在星系之上，亮度按点击量，冷色点稍微淡一点
    if (show) {
      for (const dot of dotsRef.current) {
        const spin = dot.a + frame.time * CORE_SPIN * (1 - dot.r * DISK_SHEAR);
        const x = cx + Math.cos(spin) * dot.r * disk;
        const y = cy + Math.sin(spin) * dot.r * disk;
        dot.x = x;
        dot.y = y;
        ctx.fillStyle = `rgba(${dot.color[0]},${dot.color[1]},${dot.color[2]},${(0.55 + dot.glow * 0.45).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + dot.glow * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      /*
       * 正在播的台：一圈扩散脉冲环，节奏对齐地图模式的 map-ping（2.4s）。
       * 命中检测读的是上一帧落点，脉冲环复用同一坐标，误差一帧无所谓。
       */
      if (live) {
        const target = dotsRef.current.find((d) => d.sid === live);
        if (target) {
          const phase = (frame.time % 2.4) / 2.4;
          const fade = phase < 0.7 ? 1 - phase / 0.7 : 0;
          ctx.strokeStyle = `rgba(240, 166, 60, ${(0.9 * fade).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(target.x, target.y, 4 + phase * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  };

  useFxCanvas(canvasRef, { build, draw });

  return (
    <div className="absolute inset-0" onClick={handleClick}>
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}

/* ---------------- 程序化星系 ---------------- */

/*
 * 生成一颗旋臂星系的静态结构。
 *
 * 伪随机用固定种子的 LCG，不用 Math.random：同一台设备每次进来星系
 * 长得一样——壁纸换台、切特效来回时，画面不应每次都换一副面孔。
 */
function buildGalaxy(_width: number, _height: number, count: number): GalaxyStar[] {
  const stars: GalaxyStar[] = [];
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < count; i += 1) {
    // 半径分布往中心压：sqrt 让投影密度均匀，再略偏内盘，旋臂更清楚
    const r = Math.sqrt(rand()) * 0.98;

    /*
     * 两条旋臂：基础方位角落在对数螺旋上，再按离臂距离做近似高斯散布。
     * 离中心越远散得越开——臂在内圈最紧，到外缘融进盘面。
     */
    const arm = i % 2;
    const armAngle = arm * Math.PI + Math.log(r * 4 + 1) * 2.2;
    const spread = 0.16 + r * 0.5;
    const angle = armAngle + (rand() + rand() + rand() - 1.5) * spread;

    // 颜色：核球暖金 → 外缘冷蓝，按半径插值，再给一点随机抖动
    const t = Math.min(1, Math.max(0, r * 1.15 + (rand() - 0.5) * 0.24));
    const color: [number, number, number] = [
      Math.round(255 - t * 105),
      Math.round(196 - t * 62),
      Math.round(120 + t * 110),
    ];

    stars.push({
      r,
      a: angle,
      size: 0.6 + rand() * 1.5,
      alpha: 0.25 + rand() * 0.6,
      color,
      tw: rand() * Math.PI * 2,
    });
  }
  return stars;
}

