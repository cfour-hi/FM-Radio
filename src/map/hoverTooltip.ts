import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { flagOf, placeOf } from "../lib/stationMeta";
import type { Station } from "../lib/types";
import { pickPrimary, stationsAtPoint } from "./hitTest";

/*
 * 悬停提示条：鼠标停在一个光点上，先告诉你那是谁。
 *
 * 为什么不是 React 组件：mousemove 每个像素都会来一次，走 setState 会把
 * MapPage 连同 HUD、按钮组一起重渲染。这里全程用 ref + 直接改 DOM 样式，
 * 只在地图容器里加一个绝对定位元素。
 *
 * 性能上有三条硬约束：
 *   1. rAF 合并，同一帧内的多次移动只算一次；
 *   2. 只查一次 feature，且只在台变了才重建内容，其余帧只改 transform；
 *   3. 相机在动（拖拽、缩放、flyTo）时直接不出提示——那时每帧已有 120 次
 *      map.project() 在量球体直径，再叠查询会掉帧。
 */

type Options = {
  byId: () => Map<string, Station>;
};

const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";

export function attachStationHover(map: MlMap, options: Options): () => void {
  const container = map.getContainer();
  const canHover = () =>
    typeof window.matchMedia === "function" && window.matchMedia(MOUSE_QUERY).matches;

  // 触屏设备（以及 DevTools 的触摸模拟）不挂这套逻辑
  if (!canHover()) return () => undefined;

  const tip = document.createElement("div");
  tip.className = "map-tip";
  tip.setAttribute("aria-hidden", "true");
  container.appendChild(tip);

  const nameLine = document.createElement("p");
  nameLine.className = "map-tip-name";
  const metaLine = document.createElement("p");
  metaLine.className = "map-tip-meta";
  const moreLine = document.createElement("p");
  moreLine.className = "map-tip-more";
  tip.append(nameLine, metaLine, moreLine);

  let rect: DOMRect | null = null;
  const bounds = (): DOMRect => (rect ??= container.getBoundingClientRect());

  let raf = 0;
  let pending: { x: number; y: number } | null = null;
  let shownSid: string | null = null;
  let shownCount = 0;
  let visible = false;

  const hide = () => {
    if (!visible) return;
    visible = false;
    tip.dataset.show = "0";
    shownSid = null;
    shownCount = 0;
  };

  const place = (x: number, y: number) => {
    const box = bounds();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = x + 14;
    let top = y + 16;
    if (left + w > box.width - 8) left = x - w - 14;
    if (top + h > box.height - 8) top = y - h - 12;
    // transform 不触发布局；left/top 每帧写会让整个容器反复量算
    tip.style.transform = `translate3d(${Math.max(8, left)}px, ${Math.max(8, top)}px, 0)`;
  };

  const render = (station: Station, count: number) => {
    // 只有换台或命中数变化时才碰 DOM
    if (shownSid === station.id && shownCount === count) return;
    const changed = shownSid !== station.id;
    shownSid = station.id;
    shownCount = count;

    if (changed) {
      const flag = flagOf(station.countryCode);
      nameLine.textContent = flag ? `${flag} ${station.name}` : station.name;
      metaLine.textContent = placeOf(station);
      metaLine.hidden = metaLine.textContent.length === 0;
    }
    if (count > 1) {
      moreLine.textContent = `这一带 ${count} 个台 · 点击查看`;
      moreLine.hidden = false;
    } else {
      moreLine.hidden = true;
    }
  };

  const apply = () => {
    raf = 0;
    const point = pending;
    pending = null;
    if (!point) return;
    // 相机在动：提示会跟不住光点，干脆别显示
    if (map.isMoving()) {
      hide();
      return;
    }

    const hit = stationsAtPoint(map, point, options.byId());
    const primary = pickPrimary(hit, map, point);
    if (!primary) {
      hide();
      map.getCanvas().style.cursor = "";
      return;
    }

    map.getCanvas().style.cursor = "pointer";
    render(primary, hit.stations.length);
    tip.dataset.show = "1";
    visible = true;
    // 先显示再量尺寸，否则 offsetWidth 为 0 时翻转判断会失效
    place(point.x, point.y);
  };

  const onMove = (event: MapMouseEvent) => {
    if (map.isMoving()) {
      hide();
      return;
    }
    const point = { x: event.point.x, y: event.point.y };
    // 1px 抖动不值得重算
    if (pending && Math.abs(point.x - pending.x) < 2 && Math.abs(point.y - pending.y) < 2) return;
    pending = point;
    raf ||= window.requestAnimationFrame(apply);
  };

  const onGestureStart = () => {
    hide();
    // 拖拽时把指针交还给 MapLibre，否则会一直停在 pointer 上
    map.getCanvas().style.cursor = "";
  };

  const onCanvasLeave = () => {
    pending = null;
    hide();
    map.getCanvas().style.cursor = "";
  };

  const onResize = () => {
    rect = null;
  };

  map.on("mousemove", onMove);
  for (const event of ["dragstart", "zoomstart", "rotatestart", "movestart"] as const) {
    map.on(event, onGestureStart);
  }
  map.on("resize", onResize);
  map.getCanvas().addEventListener("mouseleave", onCanvasLeave);

  return () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    map.off("mousemove", onMove);
    for (const event of ["dragstart", "zoomstart", "rotatestart", "movestart"] as const) {
      map.off(event, onGestureStart);
    }
    map.off("resize", onResize);
    map.getCanvas().removeEventListener("mouseleave", onCanvasLeave);
    tip.remove();
  };
}
