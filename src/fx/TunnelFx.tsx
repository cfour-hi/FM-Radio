import { useMemo, useRef } from "react";
import type { Station } from "../lib/types";
import { selectStationDots, useFxStationPick, type StationDotSeed } from "./dots";
import { useFxCanvas, type FxFrame } from "./useFxCanvas";

/*
 * 星流穿越。
 *
 * 经典的「超空间跳跃」画法：粒子在一个以屏幕中心为消失点的隧道里
 * 向观看者飞来，投影坐标 = 中心 + (x/z, y/z)，z 越小离得越近、
 * 飞得越快，拉出的轨迹也越长。电台点混在同一条流场里——
 * 经纬度决定它从哪个方向飞过来，每隔十几秒掠过一次眼前。
 *
 * 背景星快而暗，是「速度感」本身；电台点慢一档、亮一档，
 * 是流场里「有东西可抓」的那个，点击仍然命中。
 */

/** 背景星数量。每帧要算上一帧位置画拖尾，数量比静态特效压一档 */
const STAR_COUNT = 900;
/** z 每秒推进的基准速度：z 从 1 到 0.06 约 8 秒 */
const STAR_SPEED = 0.12;
/** 电台点的循环周期（秒）：一次完整的「远处飞来 → 掠过眼前」 */
const DOT_CYCLE = 14;

type TunnelStar = { x: number; y: number; z: number; size: number };

type TunnelDot = StationDotSeed & {
  /** 屏幕坐标，每帧更新；命中检测用。z 太近（出画）时置 NaN 表示不可点 */
  x: number;
  y: number;
  /** 流场方向 [-0.6, 0.6] 与循环相位偏移 */
  fx: number;
  fy: number;
  off: number;
};

/** 电台 → 流向：经度定横向、纬度定纵向，收在画面中部 60% 的锥体里 */
function tunnelDir(lon: number, lat: number): { fx: number; fy: number } {
  return {
    fx: ((lon + 180) / 360 - 0.5) * 1.2,
    fy: (0.5 - (lat + 90) / 180) * 1.2,
  };
}

function buildDots(stations: Station[]): TunnelDot[] {
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  return selectStationDots(stations).map((seedDot) => {
    const { fx, fy } = tunnelDir(seedDot.lon, seedDot.lat);
    return { ...seedDot, x: NaN, y: NaN, fx, fy, off: rand() * DOT_CYCLE };
  });
}

export type TunnelFxProps = {
  stations: Station[];
  /** 正在播的台：可见时画脉冲环；null 则不画 */
  liveId: string | null;
  /** showStations=false 时只出星流，不画不响应电台点 */
  showStations: boolean;
  onPickStations: (picked: Station[]) => void;
};

export default function TunnelFx({ stations, liveId, showStations, onPickStations }: TunnelFxProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dots = useMemo(() => buildDots(stations), [stations]);
  const dotsRef = useRef<TunnelDot[]>(dots);
  dotsRef.current = dots;
  const liveRef = useRef<string | null>(liveId);
  liveRef.current = liveId;
  const showRef = useRef(showStations);
  showRef.current = showStations;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  const handleClick = useFxStationPick(canvasRef, dotsRef, stationsRef, showRef, onPickStations);

  const runtime = useRef<{ stars: TunnelStar[]; ready: boolean }>({ stars: [], ready: false });

  const draw = (frame: FxFrame) => {
    const { ctx, width, height, dt } = frame;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.62;
    const rt = runtime.current;

    /*
     * 背景星懒初始化：尺寸第一次可用时再铺。随机用 Math.random 没关系——
     * 星流的方向感来自投影公式本身，不是某颗星的位置。
     */
    if (!rt.ready) {
      rt.stars = Array.from({ length: STAR_COUNT }, () => ({
        x: (Math.random() * 2 - 1) * 1.4,
        y: (Math.random() * 2 - 1) * 1.4,
        z: 0.08 + Math.random() * 0.92,
        size: 0.6 + Math.random() * 1.2,
      }));
      rt.ready = true;
    }

    // 背景星：从旧 z 到新 z 画一条短线——拖尾就是速度感
    for (const star of rt.stars) {
      const zPrev = star.z;
      star.z -= dt * STAR_SPEED;
      if (star.z <= 0.06) {
        star.z = 1;
        star.x = (Math.random() * 2 - 1) * 1.4;
        star.y = (Math.random() * 2 - 1) * 1.4;
        continue;
      }
      const k = 1 / star.z;
      const kPrev = 1 / zPrev;
      const x = cx + star.x * k * scale;
      const y = cy + star.y * k * scale;
      const px = cx + star.x * kPrev * scale;
      const py = cy + star.y * kPrev * scale;
      // 越近越亮，快出画时淡掉，避免糊脸
      const near = Math.min(1, (1 - star.z) * 1.4);
      const alpha = 0.18 + near * 0.5;
      ctx.strokeStyle = `rgba(190, 214, 236, ${alpha.toFixed(3)})`;
      ctx.lineWidth = star.size;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // 中心辉光：消失点不是死黑的一个点，给隧道一个「深处」
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.28);
    glow.addColorStop(0, "rgba(150, 190, 235, 0.22)");
    glow.addColorStop(1, "rgba(150, 190, 235, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, scale * 0.28, 0, Math.PI * 2);
    ctx.fill();

    const show = showRef.current;
    const live = liveRef.current;

    // 电台点：同一条流场，慢一档、亮一档
    if (show) {
      for (const dot of dotsRef.current) {
        // 循环相位：1 → 0，匀速飞向观看者
        const cycle = 1 - ((frame.time + dot.off) % DOT_CYCLE) / DOT_CYCLE;
        const z = 0.08 + cycle * 0.92;
        const k = 1 / z;
        const x = cx + dot.fx * k * scale;
        const y = cy + dot.fy * k * scale;
        // 出画（太近 / 飞出屏幕）就标记不可点
        if (x < -20 || x > width + 20 || y < -20 || y > height + 20) {
          dot.x = NaN;
          continue;
        }
        dot.x = x;
        dot.y = y;
        const near = Math.min(1, (1 - z) * 1.4);
        ctx.fillStyle = `rgba(${dot.color[0]},${dot.color[1]},${dot.color[2]},${(0.4 + dot.glow * 0.5 * (0.5 + near * 0.5)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, (0.9 + dot.glow * 1.6) * Math.min(2.2, k * 0.9), 0, Math.PI * 2);
        ctx.fill();
      }

      // 正在播的台：可见时画脉冲环（节奏对齐地图的 map-ping 2.4s）
      if (live) {
        const target = dotsRef.current.find((d) => d.sid === live);
        if (target && Number.isFinite(target.x)) {
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
