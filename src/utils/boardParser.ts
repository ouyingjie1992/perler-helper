import { MARK_COLOR_PALETTE } from './markPalette';
import type { MarkColor } from './markPalette';
import { rgbToLab, labDistance, sampleRegionAvg, unsharpMask, findBestMatch } from './legendExtractor';
import type { LegendSample } from './legendExtractor';
import type { PerlerBoard, PerlerCell, ColorStat } from '../types';

// ─── 色卡匹配（降级使用） ─────────────────────────────────────────────────────

const PALETTE_LAB: Array<{ color: MarkColor; lab: [number, number, number] }> =
  MARK_COLOR_PALETTE.map((color) => {
    const r = parseInt(color.hex.slice(1, 3), 16);
    const g = parseInt(color.hex.slice(3, 5), 16);
    const b = parseInt(color.hex.slice(5, 7), 16);
    return { color, lab: rgbToLab(r, g, b) };
  });

function findNearestInPalette(r: number, g: number, b: number): MarkColor {
  const lab = rgbToLab(r, g, b);
  let minDist = Infinity;
  let best = PALETTE_LAB[0].color;
  for (const { color, lab: cLab } of PALETTE_LAB) {
    const d = labDistance(lab, cLab);
    if (d < minDist) { minDist = d; best = color; }
  }
  return best;
}

// ─── 主解析函数 ───────────────────────────────────────────────────────────────

export async function parsePerlerImage(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
  legendSamples: LegendSample[] = [],
): Promise<Omit<PerlerBoard, 'id' | 'name'>> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // 锐化后再采样，提升模糊图片的颜色纯度
        const data = unsharpMask(rawImageData.data, canvas.width, canvas.height, 1.5, 1);

        const effectiveW = img.naturalWidth - margin.left - margin.right;
        const effectiveH = img.naturalHeight - margin.top - margin.bottom;
        const cellW = effectiveW / gridCols;
        const cellH = effectiveH / gridRows;

        const cells: PerlerCell[] = [];
        const colorBucket = new Map<string, { hex: string; cells: Array<{ row: number; col: number }> }>();

        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            const x0 = Math.round(margin.left + c * cellW);
            const y0 = Math.round(margin.top + r * cellH);
            const x1 = Math.round(margin.left + (c + 1) * cellW);
            const y1 = Math.round(margin.top + (r + 1) * cellH);

            const avg = sampleRegionAvg(data, canvas.width, x0, y0, x1, y1);
            if (!avg) continue;

            const brightness = (avg.r + avg.g + avg.b) / 3;
            if (brightness > 228) continue;

            let code: string;
            let hex: string;

            if (legendSamples.length > 0) {
              const match = findBestMatch(avg.r, avg.g, avg.b, legendSamples);
              if (match) {
                code = match.code;
                hex = match.sampledHex;
              } else {
                const fallback = findNearestInPalette(avg.r, avg.g, avg.b);
                code = fallback.code;
                hex = fallback.hex;
              }
            } else {
              const match = findNearestInPalette(avg.r, avg.g, avg.b);
              code = match.code;
              hex = match.hex;
            }

            cells.push({ row: r, col: c, colorCode: code, colorHex: hex });

            if (!colorBucket.has(code)) colorBucket.set(code, { hex, cells: [] });
            colorBucket.get(code)!.cells.push({ row: r, col: c });
          }
        }

        const colorStats: ColorStat[] = Array.from(colorBucket.entries())
          .map(([colorCode, { hex, cells: cl }]) => ({
            colorCode,
            colorHex: hex,
            count: cl.length,
            cells: cl,
          }))
          .sort((a, b) => b.count - a.count);

        resolve({ rows: gridRows, cols: gridCols, cells, colorStats, imageDataUrl });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageDataUrl;
  });
}

// ─── 颜色工具 ────────────────────────────────────────────────────────────────

export function darkenColor(hex: string, factor: number = 0.15): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? '#000000' : '#ffffff';
}

export type { LegendSample };
