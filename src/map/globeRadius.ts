/** 遮罩不可见时不做投影；重新显示或尺寸变化后必须重新测量。 */
export function createGlobeRadiusSync(measure: () => number, apply: (radius: number) => void) {
  let measuredZoom = Number.NaN;
  return {
    invalidate() {
      measuredZoom = Number.NaN;
    },
    sync(zoom: number, visible: boolean) {
      if (!visible) {
        measuredZoom = Number.NaN;
        return;
      }
      if (Math.abs(zoom - measuredZoom) < 0.004) return;
      const radius = measure();
      if (!Number.isFinite(radius) || radius < 24) return;
      measuredZoom = zoom;
      apply(radius);
    },
  };
}
