import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  loadGrayscale,
  computeProjections,
  detectBoardRegion,
} from '../utils/imageProcessor.js';
import { analyzeGrid } from '../utils/gridAnalyzer.js';

export const detectGridRouter = Router();

detectGridRouter.post('/', async (req: Request, res: Response) => {
  const { imageDataUrl } = req.body as { imageDataUrl?: string };

  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'imageDataUrl 格式无效' });
    return;
  }

  try {
    const gray = await loadGrayscale(imageDataUrl);

    // Step 1: 检测有效格子矩形区域（Sobel 边缘积分 + 周期性验证）
    const region = await detectBoardRegion(gray);

    let marginLeft   = region.left;
    let marginTop    = region.top;
    let marginRight  = region.right;
    let marginBottom = region.bottom;

    let effectiveW = gray.width  - marginLeft - marginRight;
    let effectiveH = gray.height - marginTop  - marginBottom;

    // Step 2: 在有效区域内计算行/列投影（裁剪后）
    const { colProjection, rowProjection } = computeProjections(gray);
    let croppedCol = colProjection.slice(marginLeft, gray.width - marginRight);
    let croppedRow = rowProjection.slice(marginTop, gray.height - marginBottom);

    // Step 3: 三方法融合分析格子数
    let result = analyzeGrid(
      croppedCol,
      croppedRow,
      Math.max(1, effectiveW),
      Math.max(1, effectiveH),
      gray.width,
      gray.height,
      { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
    );

    // Step 4: 用列方向的 cellW 对齐行方向边界
    // 有些图片（带底部图例）即使经过周期性收缩仍不精确；
    // 拼豆图纸通常格子为正方形或接近正方形，用列方向推算的 cellW
    // 来校验行方向：如果 effectiveH / cellW 更接近整数，则采用正方形假设
    if (result.cellW > 0 && result.cellH > 0) {
      const squareRows = Math.round(effectiveH / result.cellW);
      const rectRows   = result.rows;
      const squareResid = Math.abs(effectiveH - squareRows * result.cellW);
      const rectResid   = Math.abs(effectiveH - rectRows   * result.cellH);

      // 如果正方形假设更整齐（残差小 30% 以上），且行数合理（>= 列数 * 0.5），则采纳
      if (squareResid < rectResid * 0.7 && squareRows >= result.cols * 0.5) {
        const oldRows = result.rows;
        result = { ...result, rows: squareRows, cellH: result.cellW };
        console.log(
          `[detect-grid] square-cell correction: rows ${oldRows} → ${squareRows}` +
          ` (cellH adjusted to ${result.cellW}px)`,
        );
      }
    }

    // Step 5: 如果有效区高度能被 cellH 整除但余数表明 bottom margin 应更大，修正
    // （处理底部图例没被完全排除的情况）
    if (result.cellH > 0) {
      const idealH = result.rows * result.cellH;
      const excess = effectiveH - idealH;
      if (excess > result.cellH * 0.5) {
        // 多出超过半格，收缩 bottom
        const trimPx = Math.round(excess);
        marginBottom += trimPx;
        effectiveH   -= trimPx;
        result = { ...result, margin: { ...result.margin, bottom: marginBottom } };
        console.log(`[detect-grid] trim bottom by ${trimPx}px (excess=${excess.toFixed(1)}px)`);
      }
    }

    console.log(
      `[detect-grid] img=${gray.width}×${gray.height}` +
      ` region=[L${marginLeft} T${marginTop} R${marginRight} B${marginBottom}]` +
      ` eff=${effectiveW}×${effectiveH}` +
      ` (confidence=${region.confidence.toFixed(2)})` +
      ` → ${result.cols}×${result.rows} cells` +
      ` cellSize=${result.cellW}×${result.cellH}px` +
      ` via ${result.method}`,
    );

    res.json(result);
  } catch (err) {
    console.error('[detect-grid]', err);
    res.status(500).json({ error: '网格检测失败', detail: String(err) });
  }
});
