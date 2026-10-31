/** Sample only the glow circle in this puppet's own cropped piece artwork. */
export const DEFAULT_BEACON_COLOR = '#ffe68c';

export function sampleBeaconColor(canvas, spec, box, size) {
  const cx = spec.cx * size - box.x;
  const cy = spec.cy * size - box.y;
  const radius = spec.r * size;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const width = Math.min(canvas.width - x0, Math.ceil(radius * 2 + 1));
  const height = Math.min(canvas.height - y0, Math.ceil(radius * 2 + 1));
  const { data } = canvas.getContext('2d').getImageData(x0, y0, width, height);
  let red = 0; let green = 0; let blue = 0; let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x0 + x + 0.5 - cx) ** 2 + (y0 + y + 0.5 - cy) ** 2 > radius ** 2) continue;
      const i = (y * width + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      if (!(data[i + 3] >= 230)) continue;
      // Outline ink (#17233a), including its antialiased fringe.
      if ((r - 23) ** 2 + (g - 35) ** 2 + (b - 58) ** 2 < 2500) continue;
      // Blank, paper and cream backing; retain pale saturated paint colours.
      if (Math.min(r, g, b) > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 38) continue;
      red += r; green += g; blue += b; count += 1;
    }
  }
  if (count < Math.max(6, Math.PI * radius * radius * 0.04)) return DEFAULT_BEACON_COLOR;
  return `#${[red, green, blue].map((sum) => Math.round(sum / count).toString(16).padStart(2, '0')).join('')}`;
}
