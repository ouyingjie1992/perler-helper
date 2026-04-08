import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAndSharpen, sampleRegionAvg } from '../utils/imageProcessor.js';
import { findNearestColor } from '../utils/colorMatcher.js';
import type { LegendSampleInput } from '../utils/colorMatcher.js';

export const parseImageRouter = Router();

interface ParseImageBody {
  imageDataUrl: string;
  gridCols: number;
  gridRows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  legendSamples: LegendSampleInput[];
}

interface PerlerCell {
  row: number;
  col: number;
  colorCode: string;
  colorHex: string;
}

interface ColorStat {
  colorCode: string;
  colorHex: string;
  count: number;
  cells: Array<{ row: number; col: number }>;
}

parseImageRouter.post('/', async (req: Request, res: Response) => {
  const {
    imageDataUrl,
    gridCols,
    gridRows,
    margin = { top: 0, right: 0, bottom: 0, left: 0 },
    legendSamples = [],
  } = req.body as ParseImageBody;

  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'imageDataUrl 格式无效' });
    return;
  }
  if (!Number.isFinite(gridCols) || !Number.isFinite(gridRows) || gridCols < 1 || gridRows < 1) {
    res.status(400).json({ error: 'gridCols/gridRows 参数无效' });
    return;
  }

  try {
    // sharp 解码 + 专业 Unsharp Mask（替换原来手写的 box-blur 锐化）
    const img = await loadAndSharpen(imageDataUrl);
    const { width, height } = img;

    const effectiveW = width  - margin.left - margin.right;
    const effectiveH = height - margin.top  - margin.bottom;
    const cellW = effectiveW / gridCols;
    const cellH = effectiveH / gridRows;

    // 每个格子向内缩进的像素数，用于跳过单元格自带的分隔线/边框。
    // 策略：取格子短边的 15%，但最少 1px、最多 4px，兼顾小图和大图。
    const insetX = Math.min(4, Math.max(1, Math.round(cellW * 0.15)));
    const insetY = Math.min(4, Math.max(1, Math.round(cellH * 0.15)));

    console.log(
      `[parse-image] grid=${gridCols}×${gridRows}` +
      ` cellSize=${cellW.toFixed(1)}×${cellH.toFixed(1)}px` +
      ` inset=${insetX}×${insetY}px`,
    );

    const cells: PerlerCell[] = [];
    const colorBucket = new Map<string, { hex: string; cells: Array<{ row: number; col: number }> }>();

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        // 格子完整边界（原图像素）
        const cellX0 = Math.round(margin.left + c * cellW);
        const cellY0 = Math.round(margin.top  + r * cellH);
        const cellX1 = Math.round(margin.left + (c + 1) * cellW);
        const cellY1 = Math.round(margin.top  + (r + 1) * cellH);

        // 内缩后的取色区域，确保至少保留 1px
        const x0 = Math.min(cellX0 + insetX, cellX1 - 1);
        const y0 = Math.min(cellY0 + insetY, cellY1 - 1);
        const x1 = Math.max(cellX1 - insetX, x0 + 1);
        const y1 = Math.max(cellY1 - insetY, y0 + 1);

        const avg = sampleRegionAvg(img, x0, y0, x1, y1);
        if (!avg) continue;

        // 过滤白色背景（亮度 > 228）
        const brightness = (avg.r + avg.g + avg.b) / 3;
        if (brightness > 228) continue;

        // CIEDE2000 色彩匹配（比原来 CIE76 精确）
        const { code, hex } = findNearestColor(avg.r, avg.g, avg.b, legendSamples);

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

    res.json({ rows: gridRows, cols: gridCols, cells, colorStats });
  } catch (err) {
    console.error('[parse-image]', err);
    res.status(500).json({ error: '图像解析失败', detail: String(err) });
  }
});
