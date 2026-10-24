/** [半径 px, 横向百分比, 纵向百分比, R, G, B, alpha]，保留原 CSS 的星点参数。 */
export function drawStarfield(
  canvas: HTMLCanvasElement,
  stars: readonly (readonly number[])[],
  width: number,
  height: number,
  pixelRatio: number,
): void {
  if (width <= 0 || height <= 0) return;
  const ratio = Math.max(1, pixelRatio || 1);
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // CSS 第一层在最上面，Canvas 按相反顺序叠加。
  for (let i = stars.length - 1; i >= 0; i--) {
    const [radius = 0, xp = 0, yp = 0, r = 0, g = 0, b = 0, alpha = 0] = stars[i]!;
    const x = width * xp / 100;
    const y = height * yp / 100;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}
