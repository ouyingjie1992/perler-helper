import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadGrayscale, computeProjections } from '../utils/imageProcessor.js';
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
    const { colProjection, rowProjection } = computeProjections(gray);
    const result = analyzeGrid(colProjection, rowProjection, gray.width, gray.height);
    res.json(result);
  } catch (err) {
    console.error('[detect-grid]', err);
    res.status(500).json({ error: '网格检测失败', detail: String(err) });
  }
});
