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

    // Step 1: 检测有效格子矩形区域（Sobel 边缘积分法）
    const region = await detectBoardRegion(gray);

    const marginLeft   = region.left;
    const marginTop    = region.top;
    const marginRight  = region.right;
    const marginBottom = region.bottom;

    const effectiveW = gray.width  - marginLeft - marginRight;
    const effectiveH = gray.height - marginTop  - marginBottom;

    // Step 2: 在有效区域内计算行/列投影（裁剪后）
    // 我们不重新裁剪图像，而是从完整投影中截取有效段
    const { colProjection, rowProjection } = computeProjections(gray);
    const croppedCol = colProjection.slice(marginLeft, gray.width - marginRight);
    const croppedRow = rowProjection.slice(marginTop, gray.height - marginBottom);

    // Step 3: 三方法融合分析格子数
    const result = analyzeGrid(
      croppedCol,
      croppedRow,
      Math.max(1, effectiveW),
      Math.max(1, effectiveH),
      gray.width,
      gray.height,
      { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
    );

    console.log(
      `[detect-grid] region=${marginLeft},${marginTop},${marginRight},${marginBottom}` +
      ` (confidence=${region.confidence.toFixed(2)})` +
      ` → ${result.cols}×${result.rows} cells via ${result.method}`,
    );

    res.json(result);
  } catch (err) {
    console.error('[detect-grid]', err);
    res.status(500).json({ error: '网格检测失败', detail: String(err) });
  }
});
