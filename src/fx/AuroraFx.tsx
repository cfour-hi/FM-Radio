import { useMemo, useRef } from "react";
import type { Station } from "../lib/types";
import { selectStationDots, useFxStationPick, type StationDotSeed } from "./dots";
import { useFxCanvas, type FxFrame } from "./useFxCanvas";

/*
 * 极光流。
 *
 * 三四条横向流动的极光色带：每条带子是一条沿 x 方向缓慢漂移的
 * 正弦包络线，用「从包络线向上渐隐」的竖笔触铺出来，叠加处自然
 * 提亮——canvas 的 lighter 合成模式在这里几乎是免费的辉光。
 * 颜色取冷调（青绿 / 湖蓝 / 淡紫），和地球模式太空侧的星云同族。
 *
 * 电台点垫在光带之下、缓速横向漂移——安静氛围向的特效，
 * 电台点跟着极光一起慢慢地走，点击仍然命中。
 */

/** 光带数量 */
const BAND_COUNT = 4;
/** 每条带的竖笔触间距（px）。极光是连续的光面，4px 间距看不出笔触 */
const BAND_STEP = 4;
/** 电台点漂移一圈的周期（秒） */
const DRIFT_CYCLE = 90;

type Band = { yBase: number; amp: number; freq: number; speed: number; phase: number; color: string };

type AuroraDot = StationDotSeed & {
  /** 屏幕坐标，每帧更新；命中检测用 */
  x: number;
  y: number;
  /** 归一化横向位置（漂移基准）与纵向分布偏移 */
  nx: number;
  ny: number;
};

/** 电台 → 极光下的位置：经度铺开、纬度压进带子所在的高度区间 */
function auroraPos(lon: number, lat: number): { nx: number; ny: number } {
  return {
    nx: (lon + 180) / 360,
    ny: (lat + 90) / 180, // 0 上 1 下，南极台在画面下缘
  };
}

function buildDots(stations: Station[]): AuroraDot[] {
  return selectStationDots(stations).map((seed) => {
    const { nx, ny } = auroraPos(seed.lon, seed.lat);
    return { ...seed, x: 0, y: 0, nx, ny };
  });
}

/** 固定种子的带子参数：每次进来看到的是同一场极光 */
function buildBands(): Band[] {
  let seed = 0x7a11c0de;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  // 冷调家族：青绿 → 湖蓝 → 淡紫，都是 alpha 上限 0.2 以下的淡色
  const palette = ["110, 231, 183", "96, 165, 250", "167, 139, 250", "72, 187, 199"];
  const bands: Band[] = [];
  for (let i = 0; i < BAND_COUNT; i += 1) {
    bands.push({
      yBase: 0.18 + i * 0.19 + (rand() - 0.5) * 0.05,
      amp: 0.045 + rand() * 0.05,
      freq: 1.4 + rand() * 1.8,
      speed: 0.05 + rand() * 0.08,
      phase: rand() * Math.PI * 2,
      color: palette[i % palette.length]!,
    });
  }
  return bands;
}

export type AuroraFxProps = {
  stations: Station[];
  /** 正在播的台：画脉冲环；null 则不画 */
  liveId: string | null;
  /** showStations=false 时只出极光，不画不响应电台点 */
  showStations: boolean;
  onPickStations: (picked: Station[]) => void;
};

export default function AuroraFx({ stations, liveId, showStations, onPickStations }: AuroraFxProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dots = useMemo(() => buildDots(stations), [stations]);
  const dotsRef = useRef<AuroraDot[]>(dots);
  dotsRef.current = dots;
  const liveRef = useRef<string | null>(liveId);
  liveRef.current = liveId;
  const showRef = useRef(showStations);
  showRef.current = showStations;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  const handleClick = useFxStationPick(canvasRef, dotsRef, stationsRef, showRef, onPickStations);

  const runtime = useRef<{ bands: Band[] }>({ bands: buildBands() });

  /** 某一列 x 在某条带的包络线高度（归一化） */
  const bandY = (band: Band, nx: number, time: number): number =>
    band.yBase + Math.sin(nx * band.freq * Math.PI * 2 + time * band.speed * 2 + band.phase) * band.amp;

  const draw = (frame: FxFrame) => {
    const { ctx, width, height } = frame;
    ctx.clearRect(0, 0, width, height);

    const bands = runtime.current.bands;
    const time = frame.time;

    /*
     * 极光带：lighter 合成让交叠处自然提亮。
     * 每条带从包络线往上画一段渐隐的竖笔触——「帘」的形态。
     */
    ctx.globalCompositeOperation = "lighter";
    for (const band of bands) {
      for (let x = 0; x <= width + BAND_STEP; x += BAND_STEP) {
        const nx = x / width;
        const y = bandY(band, nx, time) * height;
        const curtain = height * (0.1 + band.amp * 1.4);
        const grad = ctx.createLinearGradient(0, y, 0, y - curtain);
        grad.addColorStop(0, `rgba(${band.color}, 0.2)`);
        grad.addColorStop(1, `rgba(${band.color}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y - curtain, BAND_STEP + 0.5, curtain);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    const show = showRef.current;
    const live = liveRef.current;

    // 电台点：垫在光带之下（极光先画，点后画会盖上去——这里故意让点在最上，命中优先于氛围）
    if (show) {
      for (const dot of dotsRef.current) {
        // 缓速横向漂移：nx 起点加上时间项，出右缘从左缘回来
        const x = ((dot.nx + time / DRIFT_CYCLE) % 1) * width;
        const y = (0.08 + dot.ny * 0.72) * height;
        dot.x = x;
        dot.y = y;
        ctx.fillStyle = `rgba(${dot.color[0]},${dot.color[1]},${dot.color[2]},${(0.45 + dot.glow * 0.45).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + dot.glow * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

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

  useFxCanvas(canvasRef, { build: () => {}, draw });

  return (
    <div className="absolute inset-0" onClick={handleClick}>
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}
