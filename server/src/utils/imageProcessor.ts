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
// 周期性强度：对 1D 投影计算自相关主峰，返回峰值相关系数（0-1）
// 值越高 = 越周期均匀 = 越像格子区；图例色块区周期性极低
// ─────────────────────────────────────────────────────────────────────────────

function periodicityScore(proj: Float64Array, minPeriod = 4, maxPeriod = 80): number {
  const n = proj.length;
  if (n < minPeriod * 2) return 0;

  // z-score 归一化
  let mean = 0;
  for (let i = 0; i < n; i++) mean += proj[i];
  mean /= n;
  let std = 0;
  for (let i = 0; i < n; i++) std += (proj[i] - mean) ** 2;
  std = Math.sqrt(std / n) + 1e-9;
  const z = Array.from(proj).map(v => (v - mean) / std);

  let best = 0;
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, Math.floor(n / 2)); lag++) {
    let dot = 0;
    for (let i = 0; i < n - lag; i++) dot += z[i] * z[i + lag];
    const r = dot / (n - lag);
    if (r > best) best = r;
  }
  return Math.min(1, Math.max(0, best));
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
 *  5. 周期性验证：若行方向末端存在低周期性区域（图例色块），向上收缩 bottom margin
 *  6. 输出 { left, top, right, bottom, confidence }
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
  const refineLeft  = refineEdge(colEdge, colSeg.start, -10, 10);
  const refineRight = refineEdge(colEdge, colSeg.end,   -10, 10, true);
  const refineTop   = refineEdge(rowEdge, rowSeg.start, -10, 10);
  let   refineBot   = refineEdge(rowEdge, rowSeg.end,   -10, 10, true);

  // Step 5: 周期性验证，收缩底部图例区
  // 原理：把候选有效区在行方向分成若干窗口，计算每个窗口的行投影周期性；
  //      连续从末端往上找，直到周期性恢复到顶部区域的水平 → 该处为真实底部
  {
    const segH = refineBot - refineTop;
    // 只有当候选区域足够高时才做验证（至少 80px，否则太小）
    if (segH > 80) {
      const windowH = Math.max(20, Math.round(segH * 0.08)); // 窗口高度约 8%
      const step    = Math.max(10, Math.round(windowH / 2));

      // 计算顶部参考周期性（取最上方 20% 的区域）
      const refH = Math.round(segH * 0.20);
      const refProj = rowEdge.slice(refineTop, refineTop + refH);
      const refScore = periodicityScore(refProj);

      // 从底部往上扫描，找第一个周期性低于参考 50% 的连续区段
      let newBot = refineBot;
      let lowCount = 0; // 连续低周期性窗口数
      for (let y = refineBot - windowH; y > refineTop + Math.round(segH * 0.5); y -= step) {
        const winEnd = Math.min(refineBot, y + windowH);
        const winProj = rowEdge.slice(y, winEnd);
        const score = periodicityScore(winProj);
        if (score < refScore * 0.4) {
          lowCount++;
          if (lowCount >= 2) {
            // 两个连续低周期性窗口 → 认为从这里开始是图例区，收缩 bot
            newBot = y + step;
            break;
          }
        } else {
          lowCount = 0; // 遇到高周期性则重置
        }
      }
      refineBot = newBot;
    }
  }

  const left   = Math.max(0, refineLeft);
  const top    = Math.max(0, refineTop);
  const right  = Math.max(0, width  - refineRight);
  const bottom = Math.max(0, height - refineBot);

  // Step 6: confidence
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

/**
 * 众数池化（Dominant Color）：取区域内出现频率最高的 RGB 值。
 *
 * 相比均值池化，对纯色格子效果极好——格子内颜色均一时直接取最多的像素色，
 * 不会因边界像素或格线像素的干扰导致偏色。
 *
 * 算法：对 RGB 各自量化到 8 级（每级 32 个灰度），作为哈希键降低内存占用，
 * 找出出现次数最多的量化桶，返回该桶内实际像素的平均值（保留精度）。
 */
export function sampleRegionDominant(
  { data, width, channels }: RawImageData,
  x0: number, y0: number,
  x1: number, y1: number,
): { r: number; g: number; b: number } | null {
  // 量化步长：将 256 级量化为 32 桶（步长 8），在精度和性能之间平衡
  const QUANT = 8;

  const buckets = new Map<number, { sumR: number; sumG: number; sumB: number; count: number }>();

  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      if (x >= width) continue;
      const idx = (y * width + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const brightness = (r + g + b) / 3;
      // 过滤极亮（可能是格线反光）和极暗（可能是格线本身）像素
      if (brightness > FILTER_BRIGHT || brightness < FILTER_DARK) continue;

      // 量化键
      const qr = Math.floor(r / QUANT);
      const qg = Math.floor(g / QUANT);
      const qb = Math.floor(b / QUANT);
      const key = qr * 1024 + qg * 32 + qb; // 最多 32^3 = 32768 桶

      const bucket = buckets.get(key);
      if (bucket) {
        bucket.sumR += r; bucket.sumG += g; bucket.sumB += b; bucket.count++;
      } else {
        buckets.set(key, { sumR: r, sumG: g, sumB: b, count: 1 });
      }
    }
  }

  if (buckets.size === 0) return null;

  // 找出现次数最多的桶
  let best = { sumR: 0, sumG: 0, sumB: 0, count: 0 };
  for (const bucket of buckets.values()) {
    if (bucket.count > best.count) best = bucket;
  }

  return {
    r: Math.round(best.sumR / best.count),
    g: Math.round(best.sumG / best.count),
    b: Math.round(best.sumB / best.count),
  };
}
