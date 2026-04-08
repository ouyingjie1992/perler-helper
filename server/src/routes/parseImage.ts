import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAndSharpen, sampleRegionDominant } from '../utils/imageProcessor.js';
import { findNearestColor, PALETTE_HEX_MAP } from '../utils/colorMatcher.js';
import { ocrGrid } from '../utils/ocrGrid.js';

export const parseImageRouter = Router();

// ─── 请求/响应类型 ─────────────────────────────────────────────────────────────

/** 用户填写的单个颜色提示 */
interface HintItem {
  code: string;
  count?: number; // 该颜色在图纸中的格子数，可不填
}

interface ParseImageBody {
  imageDataUrl: string;
  gridCols: number;
  gridRows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** 用户手动选择的涉及颜色列表（含可选数量） */
  hintItems?: HintItem[];
  /** 兼容旧字段（legendSamples），已废弃 */
  legendSamples?: Array<{ code: string; sampledHex: string }>;
}

interface PerlerCell {
  row: number;
  col: number;
  colorCode: string;
  colorHex: string;
  source: 'ocr' | 'color';
}

interface ColorStat {
  colorCode: string;
  colorHex: string;
  count: number;
  /** 用户填写的期望数量（用于前端展示偏差） */
  hintCount?: number;
  cells: Array<{ row: number; col: number }>;
}

// ─── 路由处理 ──────────────────────────────────────────────────────────────────

parseImageRouter.post('/', async (req: Request, res: Response) => {
  const {
    imageDataUrl,
    gridCols,
    gridRows,
    margin = { top: 0, right: 0, bottom: 0, left: 0 },
    hintItems = [],
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
    // hintItems 整理：色码白名单（非空时缩小匹配范围），count 映射
    const hintCodeSet = new Set(hintItems.map((h) => h.code));
    const hintCountMap = new Map(hintItems.filter((h) => h.count != null).map((h) => [h.code, h.count!]));
    const hintCodes = hintCodeSet.size > 0 ? Array.from(hintCodeSet) : undefined;

    // ── Step 1: 并行启动 OCR + 图像加载 ─────────────────────────────────────
    const [ocrMap, img] = await Promise.all([
      ocrGrid(imageDataUrl, gridCols, gridRows, margin).catch((err) => {
        console.warn('[parse-image] OCR failed, falling back to color sampling:', err);
        return new Map<string, { row: number; col: number; code: string; confidence: number }>();
      }),
      loadAndSharpen(imageDataUrl),
    ]);

    const { width, height } = img;
    const effectiveW = width  - margin.left - margin.right;
    const effectiveH = height - margin.top  - margin.bottom;
    const cellW = effectiveW / gridCols;
    const cellH = effectiveH / gridRows;

    const insetX = Math.min(4, Math.max(1, Math.round(cellW * 0.15)));
    const insetY = Math.min(4, Math.max(1, Math.round(cellH * 0.15)));

    const ocrHits    = ocrMap.size;
    const totalCells = gridCols * gridRows;

    console.log(
      `[parse-image] grid=${gridCols}×${gridRows}` +
      ` cellSize=${cellW.toFixed(1)}×${cellH.toFixed(1)}px` +
      ` inset=${insetX}×${insetY}px` +
      ` OCR=${ocrHits}/${totalCells}` +
      ` hintCodes=${hintCodes?.length ?? 0}` +
      ` hintCounts=${hintCountMap.size}`,
    );

    // ── Step 2: 逐格决策 ─────────────────────────────────────────────────────
    const cells: PerlerCell[] = [];
    const colorBucket = new Map<string, { hex: string; cells: Array<{ row: number; col: number }> }>();

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const key = `${r},${c}`;

        // 优先路径：OCR 识别结果
        // 若用户提供了白名单且 OCR 结果不在白名单内，降为回落路径
        const ocrResult = ocrMap.get(key);
        if (ocrResult && (!hintCodes || hintCodeSet.has(ocrResult.code))) {
          const hex = PALETTE_HEX_MAP.get(ocrResult.code) ?? '#cccccc';
          cells.push({ row: r, col: c, colorCode: ocrResult.code, colorHex: hex, source: 'ocr' });
          if (!colorBucket.has(ocrResult.code)) colorBucket.set(ocrResult.code, { hex, cells: [] });
          colorBucket.get(ocrResult.code)!.cells.push({ row: r, col: c });
          continue;
        }

        // 回落路径：颜色采样 + CIEDE2000 匹配
        const cellX0 = Math.round(margin.left + c * cellW);
        const cellY0 = Math.round(margin.top  + r * cellH);
        const cellX1 = Math.round(margin.left + (c + 1) * cellW);
        const cellY1 = Math.round(margin.top  + (r + 1) * cellH);

        const x0 = Math.min(cellX0 + insetX, cellX1 - 1);
        const y0 = Math.min(cellY0 + insetY, cellY1 - 1);
        const x1 = Math.max(cellX1 - insetX, x0 + 1);
        const y1 = Math.max(cellY1 - insetY, y0 + 1);

        const avg = sampleRegionDominant(img, x0, y0, x1, y1);
        if (!avg) continue;

        const brightness = (avg.r + avg.g + avg.b) / 3;
        if (brightness > 228) continue;

        // 传入 hintCodes 作为色码白名单，缩小匹配范围
        const { code, hex } = findNearestColor(avg.r, avg.g, avg.b, hintCodes);
        cells.push({ row: r, col: c, colorCode: code, colorHex: hex, source: 'color' });

        if (!colorBucket.has(code)) colorBucket.set(code, { hex, cells: [] });
        colorBucket.get(code)!.cells.push({ row: r, col: c });
      }
    }

    // ── Step 3: 构建 colorStats，注入 hintCount 及偏差信息 ────────────────────
    const colorStats: ColorStat[] = Array.from(colorBucket.entries())
      .map(([colorCode, { hex, cells: cl }]) => {
        const stat: ColorStat = {
          colorCode,
          colorHex: hex,
          count: cl.length,
          cells: cl,
        };
        if (hintCountMap.has(colorCode)) {
          stat.hintCount = hintCountMap.get(colorCode);
        }
        return stat;
      })
      .sort((a, b) => b.count - a.count);

    // ── Step 4: count 约束验证 + 重新匹配 ────────────────────────────────────
    // 对偏差 >30% 的色码：把该色码的「颜色采样」格子（source=color）用全色板重新匹配
    // OCR 格子（source=ocr）置信度高，保留不动。
    for (const stat of colorStats) {
      if (stat.hintCount == null) continue;
      const diff = Math.abs(stat.count - stat.hintCount);
      const diffPct = stat.hintCount > 0 ? diff / stat.hintCount : 1;
      if (diffPct <= 0.30) continue;

      console.warn(
        `[parse-image] count mismatch: ${stat.colorCode}` +
        ` expected=${stat.hintCount} actual=${stat.count}` +
        ` diff=${Math.round(diffPct * 100)}% → rematch color-sampled cells with full palette`,
      );

      // 对该色码下通过颜色采样得到的格子，全色板重新匹配（排除当前 hintCodes 白名单限制）
      for (const cell of cells) {
        if (cell.colorCode !== stat.colorCode) continue;
        if (cell.source !== 'color') continue;          // OCR 格子保留

        const { row: r, col: c } = cell;
        const cellX0 = Math.round(margin.left + c * cellW);
        const cellY0 = Math.round(margin.top  + r * cellH);
        const cellX1 = Math.round(margin.left + (c + 1) * cellW);
        const cellY1 = Math.round(margin.top  + (r + 1) * cellH);

        const x0 = Math.min(cellX0 + insetX, cellX1 - 1);
        const y0 = Math.min(cellY0 + insetY, cellY1 - 1);
        const x1 = Math.max(cellX1 - insetX, x0 + 1);
        const y1 = Math.max(cellY1 - insetY, y0 + 1);

        const avg = sampleRegionDominant(img, x0, y0, x1, y1);
        if (!avg) continue;

        // 全色板匹配（不传 hintCodes）
        const { code: newCode, hex: newHex } = findNearestColor(avg.r, avg.g, avg.b);
        if (newCode === cell.colorCode) continue; // 结果相同，不变

        // 更新 cells 数组中的该格子
        cell.colorCode = newCode;
        cell.colorHex  = newHex;
      }
    }

    // ── Step 5: 重新构建 colorStats（经过重匹配后） ───────────────────────────
    // 只有在有重新匹配发生时才需要重算；简单起见，统一重算
    const colorBucket2 = new Map<string, { hex: string; cells: Array<{ row: number; col: number }> }>();
    for (const cell of cells) {
      if (!colorBucket2.has(cell.colorCode)) {
        colorBucket2.set(cell.colorCode, { hex: cell.colorHex, cells: [] });
      }
      colorBucket2.get(cell.colorCode)!.cells.push({ row: cell.row, col: cell.col });
    }

    const finalColorStats: ColorStat[] = Array.from(colorBucket2.entries())
      .map(([colorCode, { hex, cells: cl }]) => {
        const stat: ColorStat = {
          colorCode,
          colorHex: hex,
          count: cl.length,
          cells: cl,
        };
        if (hintCountMap.has(colorCode)) {
          stat.hintCount = hintCountMap.get(colorCode);
        }
        return stat;
      })
      .sort((a, b) => b.count - a.count);

    res.json({ rows: gridRows, cols: gridCols, cells, colorStats: finalColorStats });
  } catch (err) {
    console.error('[parse-image]', err);
    res.status(500).json({ error: '图像解析失败', detail: String(err) });
  }
});
