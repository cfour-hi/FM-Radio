import { memo, useEffect, useRef } from "react";
import stars from "../data/stars.json";
import { drawStarfield } from "../lib/starfield";

function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let lastSize = "";
    const draw = () => {
      frame = 0;
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const size = `${width}:${height}:${ratio}`;
      if (size === lastSize || width <= 0 || height <= 0) return;
      lastSize = size;
      drawStarfield(canvas, stars, width, height, ratio);
    };
    const scheduleDraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    // 窗口移至不同像素密度的屏幕时，CSS 尺寸可能不变。
    window.addEventListener("resize", scheduleDraw);
    draw();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleDraw);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <canvas ref={canvasRef} aria-hidden className="map-stars pointer-events-none absolute inset-0 z-[5] h-full w-full" />;
}

export default memo(Starfield);
