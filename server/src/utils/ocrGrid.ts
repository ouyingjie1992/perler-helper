/**
 * ocrGrid.ts
 *
 * 使用 Tesseract.js 对整张图纸做一次 OCR，
 * 再根据每格的像素坐标从识别结果中提取对应的色码文字。
 *
 * 设计要点：
 *  1. Worker 单例：Tesseract 初始化慢（~2s），全局复用，只初始化一次
 *  2. 整图 OCR + 词块坐标过滤：比逐格 OCR 快 10-50x
 *  3. 放大预处理：用 sharp 将图像放大 2-3x 并二值化，提升小字识别率
 *  4. 色码正则校验：[A-Z]{1,3}[0-9]{1,2}，过滤 OCR 噪声
 *  5. 每格取置信度最高的匹配词，置信度 < 55 视为无效，回落到颜色采样
 *
 * Tesseract.js v5 关键点：
 *  - recognize() 第三个参数 output 需要显式传 { blocks: true } 才会填充 data.blocks
 *  - 词块层级：data.blocks → .paragraphs → .lines → .words
 *  - PSM 需要导入 PSM 枚举（字符串枚举，SINGLE_BLOCK = '6'）
 */

import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

// ─── 色码正则 ─────────────────────────────────────────────────────────────────
// 格式：1-3 个大写字母 + 1-2 个数字，如 E15 / F11 / H2 / ZG1
const COLOR_CODE_RE = /^[A-Z]{1,3}[0-9]{1,2}$/;

// ─── Worker 单例 ──────────────────────────────────────────────────────────────
let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker('eng', 1, {
        // 关闭日志减少噪声
        logger: () => {},
      });
      // PSM.SINGLE_BLOCK (6)：按统一文本块识别（适合格子内短字符串）
      // PSM.SPARSE_TEXT (11)：稀疏文字模式，可识别散布各处的文字
      // 整图用 PSM.SPARSE_TEXT 更合适，避免格子间空白区域干扰
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        // 只允许色码字符集：大写字母和数字
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      });
      return w;
    })();
  }
  return workerPromise;
}

// ─── 图像预处理：放大 + 对比度增强 ───────────────────────────────────────────

/**
 * 对图纸做 OCR 预处理：
 *  - 放大 scaleFactor 倍（默认 3x），让小字达到 OCR 最佳高度（≥20px）
 *  - 转灰度 + 线性对比度拉伸（增强文字与背景对比）
 *  - 不做二值化（保留灰度让 Tesseract 自己做 Otsu）
 *
 * 返回放大后的 PNG Buffer 以及实际使用的缩放比
 */
async function preprocessForOCR(
  imageDataUrl: string,
  scaleFactor = 3,
): Promise<{ buffer: Buffer; scale: number }> {
  const base64 = imageDataUrl.split(',')[1];
  const input  = Buffer.from(base64, 'base64');

  const meta = await sharp(input).metadata();
  const origW = meta.width  ?? 0;
  const origH = meta.height ?? 0;

  // 如果图像太小，放大更多；太大则不放大（避免内存爆炸）
  const maxDim = Math.max(origW, origH);
  // 对大图（>2000px）也保持 2x 放大（原来仅 1.5x 不够），上限 3x
  const actualScale = maxDim > 3000 ? 1.5 : maxDim > 1500 ? 2 : scaleFactor;

  const newW = Math.round(origW * actualScale);
  const newH = Math.round(origH * actualScale);

  const buffer = await sharp(input)
    .resize(newW, newH, { kernel: 'lanczos3' })
    .grayscale()
    // 对比度增强：线性拉伸（normalize 拉到 0-255）
    .normalize()
    // 加强锐化，让彩色背景上的细字轮廓更清晰
    .sharpen({ sigma: 1.2, m1: 0.5, m2: 3.0 })
    .png()
    .toBuffer();

  return { buffer, scale: actualScale };
}

// ─── OCR 结果类型 ─────────────────────────────────────────────────────────────

export interface CellOCRResult {
  row: number;
  col: number;
  code: string;       // 识别到的色码，如 "E15"
  confidence: number; // Tesseract 置信度 0-100
}

// ─── 从 blocks 层级提取所有 words ─────────────────────────────────────────────

interface WordInfo {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

function extractWords(blocks: Tesseract.Block[]): WordInfo[] {
  const words: WordInfo[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            confidence: word.confidence,
            bbox: word.bbox,
          });
        }
      }
    }
  }
  return words;
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 对整张图纸执行一次 OCR，返回每格识别到的色码。
 *
 * @param imageDataUrl  原图 base64 DataURL
 * @param gridCols      列数
 * @param gridRows      行数
 * @param margin        有效区域边距（原图像素）
 * @param minConfidence 最低置信度阈值（默认 40），低于此值视为识别失败
 */
export async function ocrGrid(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number },
  minConfidence = 40,
): Promise<Map<string, CellOCRResult>> {
  // Step 1: 预处理图像
  const { buffer, scale } = await preprocessForOCR(imageDataUrl);

  // Step 2: 获取 Worker（单例）
  const worker = await getWorker();

  // Step 3: 整图 OCR
  // 第三个参数 output 必须包含 { blocks: true } 才能填充 data.blocks
  const { data } = await worker.recognize(buffer, {}, { blocks: true });

  // Step 4: 从 blocks 层级提取所有词块
  const allWords = data.blocks ? extractWords(data.blocks) : [];

  // Step 5: 在放大坐标系下计算每格的像素范围
  const base64 = imageDataUrl.split(',')[1];
  const origMeta = await sharp(Buffer.from(base64, 'base64')).metadata();
  const scaledW  = (origMeta.width  ?? 0) * scale;
  const scaledH  = (origMeta.height ?? 0) * scale;

  const scaledMarginL = margin.left   * scale;
  const scaledMarginT = margin.top    * scale;
  const scaledMarginR = margin.right  * scale;
  const scaledMarginB = margin.bottom * scale;

  const effW  = scaledW  - scaledMarginL - scaledMarginR;
  const effH  = scaledH  - scaledMarginT - scaledMarginB;
  const cellW = effW / gridCols;
  const cellH = effH / gridRows;

  // Step 6: 对每个识别到的词，判断它落在哪个格子里
  // 每格维护「最高置信度」的候选词
  const cellMap = new Map<string, CellOCRResult>();

  for (const word of allWords) {
    const rawText = word.text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!COLOR_CODE_RE.test(rawText)) continue;
    if (word.confidence < minConfidence) continue;

    // 词块中心点（放大坐标系）
    const cx = (word.bbox.x0 + word.bbox.x1) / 2;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;

    // 映射到格子坐标
    const col = Math.floor((cx - scaledMarginL) / cellW);
    const row = Math.floor((cy - scaledMarginT) / cellH);

    if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) continue;

    const key = `${row},${col}`;
    const existing = cellMap.get(key);

    // 保留置信度更高的识别结果
    if (!existing || word.confidence > existing.confidence) {
      cellMap.set(key, {
        row, col,
        code: rawText,
        confidence: word.confidence,
      });
    }
  }

  console.log(
    `[ocr-grid] recognized ${cellMap.size}/${gridCols * gridRows} cells` +
    ` (scale=${scale}x, words=${allWords.length}, blocks=${data.blocks?.length ?? 0})`,
  );

  return cellMap;
}

/**
 * 优雅关闭 OCR Worker（进程退出时调用）
 */
export async function terminateOCRWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
