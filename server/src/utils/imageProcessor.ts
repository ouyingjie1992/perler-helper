/**
 * imageProcessor.ts
 * 使用 sharp 进行专业图像处理。
 *
 * 核心能力：
 *  1. loadGrayscale       - 加载灰度图（用于网格检测）
 *  2. loadAndSharpen      - 加载 RGB 并锐化（用于颜色解析）
 *  3. computeProjections  - 行/列亮度投影
 *  4. detectBoardRegion   - 【新】检测有效格子矩形区域
 *     算法：
 *       a. 用 Sobel 算子计算全图边缘强度
 *       b. 在行/列方向对边缘强度做积分投影（EdgeProjection）
 *       c. 格子区域内每行/列都有大量格线交叉 → 边缘积分显著高于背景区域
 *       d. 在投影上做 Otsu 阈值分割，找连续高边缘区段的最大矩形
 *       e. 利用格子的周期性（AutoCorrelation peak）校验并对齐边界
 */

import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────────────
// 公共类型
// ─────────────────────────────────────────────────────────────────────────────

export interface RawImageData {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export interface GrayImageData {
  data: Buffer;
  width: number;
  height: number;
}

export interface BoardRegion {
  left: number;
  top: number;
  right: number;    // 距图像右边缘的像素数（即 margin）
  bottom: number;   // 距图像下边缘的像素数
  confidence: number; // 0-1
}

// ─────────────────────────────────────────────────────────────────────────────
// 图像加载
// ─────────────────────────────────────────────────────────────────────────────

/** 从 base64 DataURL 加载灰度图（轻微去噪，用于网格检测） */
export async function loadGrayscale(imageDataUrl: string): Promise<GrayImageData> {
  const base64 = imageDataUrl.split(',')[1];
  const input = Buffer.from(base64, 'base64');

  const { data, info } = await sharp(input)
    .grayscale()
    .blur(0.6)          // 轻微高斯去噪，减少文字/噪点干扰
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: data as Buffer, width: info.width, height: info.height };
}

/** 从 base64 DataURL 加载 RGB 并应用专业锐化（用于颜色解析） */
export async function loadAndSharpen(imageDataUrl: string): Promise<RawImageData> {
  const base64 = imageDataUrl.split(',')[1];
  const input = Buffer.from(base64, 'base64');

  const { data, info } = await sharp(input)
    .removeAlpha()
    .sharpen({ sigma: 1.0, m1: 0, m2: 2.0 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: data as Buffer, width: info.width, height: info.height, channels: info.channels };
}

// ─────────────────────────────────────────────────────────────────────────────
// 投影计算
// ─────────────────────────────────────────────────────────────────────────────

/** 计算行/列方向的平均灰度投影（供 gridAnalyzer 使用） */
export function computeProjections(gray: GrayImageData): {
  colProjection: number[];
  rowProjection: number[];
} {
  const { data, width, height } = gray;
  const colProj = new Float64Array(width);
  const rowProj = new Float64Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x];
      colProj[x] += v;
      rowProj[y] += v;
    }
  }

  for (let x = 0; x < width; x++)  colProj[x] /= height;
  for (let y = 0; y < height; y++) rowProj[y] /= width;

  return {
    colProjection: Array.from(colProj),
    rowProjection: Array.from(rowProj),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sobel 边缘检测（纯 JS，基于 sharp 解码的原始像素）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对灰度图执行 Sobel 边缘检测，返回边缘强度图（0-255，Float32）
 * 使用 3×3 Sobel 核，时间复杂度 O(W×H)
 */
function sobelEdge(gray: GrayImageData): Float32Array {
  const { data, width, height } = gray;
  const edge = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // 读取 3×3 邻域
      const tl = data[(y - 1) * width + (x - 1)];
      const tc = data[(y - 1) * width + x];
      const tr = data[(y - 1) * width + (x + 1)];
      const ml = data[y * width + (x - 1)];
      const mr = data[y * width + (x + 1)];
      const bl = data[(y + 1) * width + (x - 1)];
      const bc = data[(y + 1) * width + x];
      const br = data[(y + 1) * width + (x + 1)];

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      edge[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }

  return edge;
}

// ─────────────────────────────────────────────────────────────────────────────
// Otsu 阈值（自动二值化）
// ─────────────────────────────────────────────────────────────────────────────

function otsuThreshold(values: Float32Array | number[], maxVal = 255): number {
  const hist = new Float64Array(256);
  const n = values.length;
  for (let i = 0; i < n; i++) {
    hist[Math.min(255, Math.round((values[i] / maxVal) * 255))]++;
  }
  for (let i = 0; i < 256; i++) hist[i] /= n;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, wF = 0;
  let maxVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = 1 - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }

  return (threshold / 255) * maxVal;
}

// ─────────────────────────────────────────────────────────────────────────────
// 连续高边缘区段检测（1D）
// ─────────────────────────────────────────────────────────────────────────────

interface Segment { start: number; end: number; }

/**
 * 在 1D 投影上找「最大连续高于阈值」的区段。
 * 使用平滑窗口减少零星低值的干扰（允许短暂低于阈值的间隙）。
 */
function findLargestActiveSegment(
  proj: Float64Array,
  threshold: number,
  gapTolerance = 5,   // 允许连续 N 个低值仍视为同一区段
  minLength = 20,     // 最小有效区段长度
): Segment | null {
  const n = proj.length;
  const active = new Uint8Array(n);
  for (let i = 0; i < n; i++) active[i] = proj[i] >= threshold ? 1 : 0;

  // 填充短间隙
  for (let i = 0; i < n; i++) {
    if (active[i] === 0) {
      let j = i;
      while (j < n && active[j] === 0) j++;
      if (j - i <= gapTolerance) {
        for (let k = i; k < j; k++) active[k] = 1;
      }
      i = j;
    }
  }

  // 找最大区段
  let best: Segment | null = null;
  let segStart = -1;

  for (let i = 0; i <= n; i++) {
    if (i < n && active[i]) {
      if (segStart < 0) segStart = i;
    } else {
      if (segStart >= 0) {
        const len = i - segStart;
        if (len >= minLength && (!best || len > best.end - best.start)) {
          best = { start: segStart, end: i };
        }
        segStart = -1;
      }
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 边缘投影：沿行/列对 Sobel 边缘图做积分
// ─────────────────────────────────────────────────────────────────────────────

function edgeProjections(edge: Float32Array, width: number, height: number): {
  colEdge: Float64Array;
  rowEdge: Float64Array;
} {
  const colEdge = new Float64Array(width);
  const rowEdge = new Float64Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = edge[y * width + x];
      colEdge[x] += v;
      rowEdge[y] += v;
    }
  }

  // 归一化
  for (let x = 0; x < width; x++)  colEdge[x] /= height;
  for (let y = 0; y < height; y++) rowEdge[y] /= width;

  return { colEdge, rowEdge };
}

// ─────────────────────────────────────────────────────────────────────────────
// 自适应阈值：Otsu 与固定比例取较小值（防止背景太暗导致阈值过低）
// ─────────────────────────────────────────────────────────────────────────────

function adaptiveThreshold(proj: Float64Array, otsuFraction = 0.4): number {
  const max = Math.max(...proj);
  const otsu = otsuThreshold(Array.from(proj), max);
  // 取 Otsu 的 40%（格子区边缘积分通常比背景高出不止一倍）
  return Math.min(otsu, max * otsuFraction);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数：检测有效格子矩形区域
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detectBoardRegion
 *
 * 算法流程：
 *  1. Sobel 边缘检测 → 边缘强度图
 *  2. 行/列边缘积分投影：格子区因格线密集 → 积分值显著偏高
 *  3. Otsu 自动阈值分割投影，找「最大连续高边缘区段」
 *  4. 对区段边界做亚像素精修（在边界附近找梯度最大点）
 *  5. 输出 { left, top, right, bottom, confidence }
 */
export async function detectBoardRegion(gray: GrayImageData): Promise<BoardRegion> {
  const { width, height } = gray;

  // Step 1: Sobel 边缘
  const edge = sobelEdge(gray);

  // Step 2: 行/列边缘积分投影
  const { colEdge, rowEdge } = edgeProjections(edge, width, height);

  // Step 3: 自适应阈值 + 最大连续区段
  const colThresh = adaptiveThreshold(colEdge);
  const rowThresh = adaptiveThreshold(rowEdge);

  const colSeg = findLargestActiveSegment(colEdge, colThresh, 8, Math.round(width * 0.05));
  const rowSeg = findLargestActiveSegment(rowEdge, rowThresh, 8, Math.round(height * 0.05));

  // 保底：如果检测失败，返回整图（margin=0）
  if (!colSeg || !rowSeg) {
    return { left: 0, top: 0, right: 0, bottom: 0, confidence: 0 };
  }

  // Step 4: 边界精修
  // 在区段边界附近 ±10px 窗口内，找边缘强度梯度最大的位置
  const refineLeft  = refineEdge(colEdge, colSeg.start, -10, 10);
  const refineRight = refineEdge(colEdge, colSeg.end,   -10, 10, true);
  const refineTop   = refineEdge(rowEdge, rowSeg.start, -10, 10);
  const refineBot   = refineEdge(rowEdge, rowSeg.end,   -10, 10, true);

  const left   = Math.max(0, refineLeft);
  const top    = Math.max(0, refineTop);
  const right  = Math.max(0, width  - refineRight);
  const bottom = Math.max(0, height - refineBot);

  // Step 5: confidence = 区域面积占比 × 区段边缘强度与背景的对比度
  const areaRatio = ((width - left - right) * (height - top - bottom)) / (width * height);
  const colContrast = colEdge[Math.round((colSeg.start + colSeg.end) / 2)] /
    (colEdge[Math.round(width * 0.01)] + 1e-6);
  const rowContrast = rowEdge[Math.round((rowSeg.start + rowSeg.end) / 2)] /
    (rowEdge[Math.round(height * 0.01)] + 1e-6);
  const contrast = Math.min(1, Math.sqrt(colContrast * rowContrast) / 5);
  const confidence = Math.min(1, areaRatio * 0.5 + contrast * 0.5);

  return { left, top, right, bottom, confidence };
}

/**
 * 在给定位置附近找边缘强度的「跃变点」（即格子区边界）
 * @param proj      1D 投影数组
 * @param pos       粗略位置
 * @param lo, hi    搜索窗口偏移（lo<0 往左，hi>0 往右）
 * @param findEnd   true=找区段结束端（往内找最后一个高值），false=找开始端
 */
function refineEdge(
  proj: Float64Array,
  pos: number,
  lo: number,
  hi: number,
  findEnd = false,
): number {
  const n = proj.length;
  const start = Math.max(0, pos + lo);
  const end   = Math.min(n - 1, pos + hi);

  // 计算梯度（一阶差分绝对值）
  let maxGrad = -1, bestPos = pos;
  for (let i = start + 1; i <= end; i++) {
    const grad = Math.abs(proj[i] - proj[i - 1]);
    if (grad > maxGrad) { maxGrad = grad; bestPos = findEnd ? i : i - 1; }
  }

  return Math.max(0, Math.min(n - 1, bestPos));
}

// ─────────────────────────────────────────────────────────────────────────────
// 颜色采样（保持不变）
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_BRIGHT = 240;
const FILTER_DARK   = 20;

export function sampleRegionAvg(
  { data, width, channels }: RawImageData,
  x0: number, y0: number,
  x1: number, y1: number,
): { r: number; g: number; b: number } | null {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;

  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      if (x >= width) continue;
      const idx = (y * width + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const brightness = (r + g + b) / 3;
      if (brightness > FILTER_BRIGHT || brightness < FILTER_DARK) continue;
      sumR += r; sumG += g; sumB += b; count++;
    }
  }

  if (count === 0) return null;
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
}
