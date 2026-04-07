/**
 * gridAnalyzer.ts
 * 基于 FFT（快速傅里叶变换）的网格规格检测
 *
 * 算法升级说明：
 * 原算法：局部极值统计 + 众数间距（容易受噪声影响）
 * 新算法：Cooley-Tukey FFT 频谱分析
 *   1. 计算行/列方向亮度投影（均值）
 *   2. 去掉直流分量（减均值）
 *   3. FFT 求频谱，找主频率 → 对应格子尺寸 cellSize
 *   4. 已知 cellSize 后，扫描投影找第一个波谷位置 → margin
 *   5. 由 (图像尺寸 - 总边距) / cellSize 得到行列数
 *
 * FFT 方法的优势：
 * - 全局频率估计，不受个别噪声峰影响
 * - 对分辨率差异、轻微视角倾斜更鲁棒
 * - 时间复杂度 O(n log n) vs 原来 O(n²) 的众数统计
 */

export interface GridAnalysisResult {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number;
}

// ─── Cooley-Tukey FFT（迭代版，原地计算） ────────────────────────────────────

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * 原地 Cooley-Tukey FFT（复数平面，实部/虚部分离存储）
 * 复杂度 O(n log n)
 */
function inPlaceFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  // 位反转置换（bit-reversal permutation）
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // 蝶式运算（butterfly operations）
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wBaseRe = Math.cos(ang);
    const wBaseIm = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = i + j + len / 2;
        const uRe = re[a], uIm = im[a];
        const vRe = re[b] * wRe - im[b] * wIm;
        const vIm = re[b] * wIm + im[b] * wRe;
        re[a] = uRe + vRe;  im[a] = uIm + vIm;
        re[b] = uRe - vRe;  im[b] = uIm - vIm;
        const tmp = wRe * wBaseRe - wIm * wBaseIm;
        wIm = wRe * wBaseIm + wIm * wBaseRe;
        wRe = tmp;
      }
    }
  }
}

// ─── 投影分析 ─────────────────────────────────────────────────────────────────

interface SpacingResult {
  spacing: number;    // 格子尺寸（像素）
  confidence: number; // 0-1，频谱主频能量占比
}

/**
 * 给定 1D 亮度投影，用 FFT 找主周期（即格子间距）
 * @param projection  行/列平均灰度数组
 * @param minCell     最小格子像素数（默认 4），过滤高频噪声
 * @param maxCell     最大格子像素数（默认 length/3）
 */
function detectSpacingFFT(
  projection: number[],
  minCell = 4,
  maxCell?: number,
): SpacingResult {
  const n = projection.length;
  if (!maxCell) maxCell = Math.floor(n / 3);

  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // 去直流分量（减均值），让 FFT 的 DC 分量 = 0
  const mean = projection.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) re[i] = projection[i] - mean;

  inPlaceFFT(re, im);

  // 有效频率范围：对应格子尺寸在 [minCell, maxCell] 内
  // 频率 k → 周期 T = N/k（注意这里用 N 而不是 n，因为零填充后 N ≥ n）
  // 为了搜索对应实际图像长度 n 的周期，k_min = n/maxCell, k_max = n/minCell
  const kMin = Math.max(1, Math.ceil(n / maxCell));
  const kMax = Math.min(Math.floor(N / 2), Math.floor(n / minCell));

  let maxMag2 = 0, bestK = -1, totalPower = 0;

  for (let k = 1; k <= N / 2; k++) {
    const mag2 = re[k] ** 2 + im[k] ** 2;
    totalPower += mag2;
    if (k >= kMin && k <= kMax && mag2 > maxMag2) {
      maxMag2 = mag2;
      bestK = k;
    }
  }

  if (bestK < 0 || totalPower === 0) {
    return { spacing: Math.round(n / 48), confidence: 0 };
  }

  // 频率 k 对应的实际周期（以原图像像素为单位）
  // 注意：FFT 对 n-点无填充信号的频率分辨率为 1/n
  // 零填充到 N 后，实际频率分辨率变高，但最高频率对应的周期仍是 n/k
  const spacing = n / bestK;
  const confidence = Math.min(1, maxMag2 / totalPower);

  return { spacing, confidence };
}

/**
 * 已知 spacing 后，在投影开头扫描找第一个波谷（格线位置）
 * 返回第一条格线距图像边缘的位置（即 margin）
 */
function findFirstMinimum(projection: number[], spacing: number): number {
  const searchEnd = Math.min(projection.length, Math.round(spacing * 2));
  // 在开头 2*spacing 范围内找最小值位置
  let minVal = Infinity, minPos = 0;
  for (let i = 0; i < searchEnd; i++) {
    if (projection[i] < minVal) { minVal = projection[i]; minPos = i; }
  }
  // 如果最小值太靠边缘（< 0.1*spacing），认为没有 margin
  return minPos < spacing * 0.1 ? 0 : minPos;
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 分析行/列投影，返回网格规格
 * @param colProjection  每列的平均灰度数组，长度=图像宽度
 * @param rowProjection  每行的平均灰度数组，长度=图像高度
 * @param width          图像宽度（像素）
 * @param height         图像高度（像素）
 */
export function analyzeGrid(
  colProjection: number[],
  rowProjection: number[],
  width: number,
  height: number,
): GridAnalysisResult {
  const MIN_CELL = 4;

  const w = detectSpacingFFT(colProjection, MIN_CELL);
  const h = detectSpacingFFT(rowProjection, MIN_CELL);

  // 保底：如果检测失败，假设 48 格
  const cellW = w.spacing >= MIN_CELL ? w.spacing : Math.round(width / 48);
  const cellH = h.spacing >= MIN_CELL ? h.spacing : Math.round(height / 48);

  const marginLeft   = findFirstMinimum(colProjection, cellW);
  const marginTop    = findFirstMinimum(rowProjection, cellH);

  // 右/下 margin：镜像处理
  const revCol = [...colProjection].reverse();
  const revRow = [...rowProjection].reverse();
  const marginRight  = findFirstMinimum(revCol, cellW);
  const marginBottom = findFirstMinimum(revRow, cellH);

  const effectiveW = width  - marginLeft - marginRight;
  const effectiveH = height - marginTop  - marginBottom;

  const cols = Math.max(1, Math.round(effectiveW / cellW));
  const rows = Math.max(1, Math.round(effectiveH / cellH));

  const confidence = (w.confidence + h.confidence) / 2;

  return {
    cellW: Math.round(cellW),
    cellH: Math.round(cellH),
    cols,
    rows,
    margin: {
      top:    marginTop,
      right:  marginRight,
      bottom: marginBottom,
      left:   marginLeft,
    },
    confidence,
  };
}
