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

    const cells: PerlerCell[] = [];
    const colorBucket = new Map<string, { hex: string; cells: Array<{ row: number; col: number }> }>();

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const x0 = Math.round(margin.left + c * cellW);
        const y0 = Math.round(margin.top  + r * cellH);
        const x1 = Math.round(margin.left + (c + 1) * cellW);
        const y1 = Math.round(margin.top  + (r + 1) * cellH);

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
