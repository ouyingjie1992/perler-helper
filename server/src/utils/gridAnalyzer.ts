/**
 * gridAnalyzer.ts
 *
 * 在已知有效格子区域（margin 已裁剪）内估计行列数。
 *
 * 算法使用三层策略，结果融合投票：
 *
 * ① AutoCorrelation（循环自相关）
 *    - 对裁剪后区域的行/列投影做归一化自相关
 *    - 找第一个显著峰值 → 格子间距
 *    - 优点：对均匀格线（白色网格线）非常稳定
 *    - 使用 ml-matrix 的 Matrix 做向量运算加速
 *
 * ② Peak Detection（峰值计数）
 *    - 对投影做高斯平滑后，统计局部极大值（格线亮峰）数量
 *    - 结合 Prominence 过滤伪峰
 *
 * ③ FFT（快速傅里叶变换）
 *    - 找投影信号的主频率 → 对应格子间距
 *    - 原有方法保留，但作为第三票
 *
 * 三种方法各自估算格子数，用加权中位数融合，优先选取一致性高的结果。
 */

import { Matrix } from 'ml-matrix';

export interface GridAnalysisResult {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number;
  method: string; // 调试信息：哪种方法胜出
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/** 高斯平滑（1D，sigma 控制平滑程度） */
function gaussianSmooth(arr: number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.max(0, Math.min(n - 1, i + k));
      s += arr[j] * kernel[k + radius];
    }
    out[i] = s;
  }
  return out;
}

/** 对数组做 z-score 归一化（均值0，标准差1） */
function zNormalize(arr: number[]): number[] {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std  = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length) + 1e-9;
  return arr.map(v => (v - mean) / std);
}

// ─────────────────────────────────────────────────────────────────────────────
// 方法①：归一化循环自相关（Normalized Autocorrelation）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算 1D 信号的归一化自相关，返回 lag=1..maxLag 的相关系数数组。
 * 使用 ml-matrix 的向量点积加速。
 *
 * 自相关峰值 lag = 格子间距（像素）
 */
function autocorrelation(signal: number[], maxLag: number): number[] {
  const n = signal.length;
  const znorm = zNormalize(signal);
  const vec = Matrix.columnVector(znorm);
  const result: number[] = [];

  for (let lag = 1; lag <= Math.min(maxLag, n - 1); lag++) {
    // 计算 znorm[0..n-lag-1] 与 znorm[lag..n-1] 的点积
    const a = Matrix.columnVector(znorm.slice(0, n - lag));
    const b = Matrix.columnVector(znorm.slice(lag));
    // dot product: a^T * b
    const dot = a.transpose().mmul(b).get(0, 0);
    result.push(dot / (n - lag));
  }
  return result;
}

/**
 * 在自相关数组中找第一个显著正峰值，返回对应 lag（即格子间距）。
 * 使用 Prominence 过滤噪声峰。
 */
function findFirstACPeak(ac: number[], minLag: number, maxLag: number): number | null {
  const n = ac.length;

  // 找所有局部极大值（ac 已是从 lag=1 开始的数组）
  const peaks: Array<{ lag: number; val: number }> = [];

  for (let i = 1; i < n - 1; i++) {
    const lag = i + 1; // ac[i] 对应 lag = i+1
    if (lag < minLag || lag > maxLag) continue;
    if (ac[i] > ac[i - 1] && ac[i] > ac[i + 1] && ac[i] > 0.05) {
      peaks.push({ lag, val: ac[i] });
    }
  }

  if (peaks.length === 0) return null;

  // 按相关值降序，取第一个（最强）峰
  peaks.sort((a, b) => b.val - a.val);
  return peaks[0].lag;
}

// ─────────────────────────────────────────────────────────────────────────────
// 方法②：峰值计数（Peak Counting）
// ─────────────────────────────────────────────────────────────────────────────

interface Peak { pos: number; val: number; prominence: number; }

/**
 * 在平滑投影中找局部极大值，计算 Prominence（峰值突出度）并过滤。
 * Prominence = 峰值 - max(左侧最低点, 右侧最低点)
 */
function findPeaks(arr: number[], minProminence: number, minDistance: number): Peak[] {
  const n = arr.length;
  const peaks: Peak[] = [];

  for (let i = 1; i < n - 1; i++) {
    if (arr[i] <= arr[i - 1] || arr[i] <= arr[i + 1]) continue;

    // 计算 Prominence：向左找谷，向右找谷
    let leftMin = arr[i];
    for (let j = i - 1; j >= 0; j--) {
      if (arr[j] < leftMin) leftMin = arr[j];
      if (arr[j] > arr[i]) break; // 遇到更高峰停止
    }
    let rightMin = arr[i];
    for (let j = i + 1; j < n; j++) {
      if (arr[j] < rightMin) rightMin = arr[j];
      if (arr[j] > arr[i]) break;
    }
    const prominence = arr[i] - Math.max(leftMin, rightMin);
    if (prominence >= minProminence) peaks.push({ pos: i, val: arr[i], prominence });
  }

  // NMS：去除距离过近的峰（保留 prominence 更大的）
  peaks.sort((a, b) => b.prominence - a.prominence);
  const kept: Peak[] = [];
  for (const p of peaks) {
    if (!kept.some(k => Math.abs(k.pos - p.pos) < minDistance)) kept.push(p);
  }
  kept.sort((a, b) => a.pos - b.pos);
  return kept;
}

/**
 * 用峰值计数估算格子数和间距。
 * 拼豆图纸：格线是白色细线 → 投影在格线处有局部亮峰。
 * 返回 { count, spacing } 或 null（检测失败）
 */
function estimateByPeaks(
  projection: number[],
  length: number,
  minCell: number,
  maxCell: number,
): { count: number; spacing: number } | null {
  // 高斯平滑（sigma=格子最小尺寸/4，减少文字噪声）
  const sigma = Math.max(1, minCell / 4);
  const smooth = gaussianSmooth(projection, sigma);

  const maxVal = Math.max(...smooth);
  const minProminence = maxVal * 0.05; // 峰值突出度至少占最大值的 5%

  const peaks = findPeaks(smooth, minProminence, minCell);
  if (peaks.length < 2) return null;

  // 估算平均间距
  const spacings: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    spacings.push(peaks[i].pos - peaks[i - 1].pos);
  }
  // 中位数间距（对离群值更鲁棒）
  spacings.sort((a, b) => a - b);
  const medSpacing = spacings[Math.floor(spacings.length / 2)];

  if (medSpacing < minCell || medSpacing > maxCell) return null;

  const count = Math.round(length / medSpacing);
  return { count: Math.max(1, count), spacing: medSpacing };
}

// ─────────────────────────────────────────────────────────────────────────────
// 方法③：FFT（保留原有逻辑，但只在裁剪后区域内运行）
// ─────────────────────────────────────────────────────────────────────────────

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function inPlaceFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wBR = Math.cos(ang), wBI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wR = 1, wI = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = i + j + len / 2;
        const uR = re[a], uI = im[a];
        const vR = re[b] * wR - im[b] * wI;
        const vI = re[b] * wI + im[b] * wR;
        re[a] = uR + vR; im[a] = uI + vI;
        re[b] = uR - vR; im[b] = uI - vI;
        const tmp = wR * wBR - wI * wBI;
        wI = wR * wBI + wI * wBR;
        wR = tmp;
      }
    }
  }
}

function estimateByFFT(
  projection: number[],
  length: number,
  minCell: number,
  maxCell: number,
): { count: number; spacing: number; confidence: number } | null {
  const n = projection.length;
  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  const mean = projection.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) re[i] = projection[i] - mean;

  inPlaceFFT(re, im);

  const kMin = Math.max(1, Math.ceil(n / maxCell));
  const kMax = Math.min(Math.floor(N / 2), Math.floor(n / minCell));

  let maxMag2 = 0, bestK = -1, totalPower = 0;
  for (let k = 1; k <= N / 2; k++) {
    const mag2 = re[k] ** 2 + im[k] ** 2;
    totalPower += mag2;
    if (k >= kMin && k <= kMax && mag2 > maxMag2) { maxMag2 = mag2; bestK = k; }
  }

  if (bestK < 0 || totalPower === 0) return null;

  const spacing = n / bestK;
  const confidence = Math.min(1, maxMag2 / totalPower);
  const count = Math.round(length / spacing);

  return { count: Math.max(1, count), spacing, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// 融合策略：加权投票
// ─────────────────────────────────────────────────────────────────────────────

interface Estimate {
  count: number;
  spacing: number;
  weight: number;
  label: string;
}

/**
 * 给定若干独立估计，用「邻近一致性加权」选出最可信的结果。
 *
 * 策略：
 *  - 对每个估计，统计有多少其他估计在 ±2 格以内 → consistency score
 *  - weight × consistency → 综合得分
 *  - 取综合得分最高的估计
 */
function fuseEstimates(estimates: Estimate[]): { count: number; spacing: number; label: string } {
  if (estimates.length === 0) {
    return { count: 48, spacing: 0, label: 'fallback' };
  }
  if (estimates.length === 1) {
    return { count: estimates[0].count, spacing: estimates[0].spacing, label: estimates[0].label };
  }

  const TOLERANCE = 2; // ±2 格视为一致

  const scores = estimates.map((e, i) => {
    let consistency = 0;
    for (let j = 0; j < estimates.length; j++) {
      if (i === j) continue;
      if (Math.abs(estimates[j].count - e.count) <= TOLERANCE) {
        consistency += estimates[j].weight;
      }
    }
    return e.weight * (1 + consistency);
  });

  const best = scores.reduce((bi, s, i) => s > scores[bi] ? i : bi, 0);
  return {
    count: estimates[best].count,
    spacing: estimates[best].spacing,
    label: estimates[best].label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主导出：analyzeGrid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 分析裁剪后（有效区域内）的行/列投影，估算格子数和间距。
 *
 * @param colProjection  裁剪区域内每列的平均灰度（长度=effectiveWidth）
 * @param rowProjection  裁剪区域内每行的平均灰度（长度=effectiveHeight）
 * @param effectiveWidth  有效区域宽度（px）
 * @param effectiveHeight 有效区域高度（px）
 * @param fullWidth       原图宽度（用于 margin 计算）
 * @param fullHeight      原图高度
 * @param margin          已检测到的边距（left/top/right/bottom，原图像素）
 */
export function analyzeGrid(
  colProjection: number[],
  rowProjection: number[],
  effectiveWidth: number,
  effectiveHeight: number,
  fullWidth: number,
  fullHeight: number,
  margin: { top: number; right: number; bottom: number; left: number },
): GridAnalysisResult {
  // 格子尺寸合理范围：最小 4px，最大 有效区域 / 3
  const MIN_CELL = 4;
  const maxCellW = Math.max(MIN_CELL + 1, Math.floor(effectiveWidth / 3));
  const maxCellH = Math.max(MIN_CELL + 1, Math.floor(effectiveHeight / 3));

  // ── 列方向（估算 cols）────────────────────────────────────────────────────
  const colEstimates: Estimate[] = [];

  // 方法① AutoCorrelation（列）
  const acW = autocorrelation(colProjection, maxCellW);
  const acPeakW = findFirstACPeak(acW, MIN_CELL, maxCellW);
  if (acPeakW) {
    const count = Math.round(effectiveWidth / acPeakW);
    colEstimates.push({ count, spacing: acPeakW, weight: 3.0, label: 'AC-col' });
  }

  // 方法② Peak Counting（列）
  const pkW = estimateByPeaks(colProjection, effectiveWidth, MIN_CELL, maxCellW);
  if (pkW) {
    colEstimates.push({ count: pkW.count, spacing: pkW.spacing, weight: 2.0, label: 'Peak-col' });
  }

  // 方法③ FFT（列）
  const fftW = estimateByFFT(colProjection, effectiveWidth, MIN_CELL, maxCellW);
  if (fftW) {
    colEstimates.push({
      count: fftW.count, spacing: fftW.spacing,
      weight: 1.0 + fftW.confidence, label: 'FFT-col',
    });
  }

  const colResult = fuseEstimates(colEstimates);

  // ── 行方向（估算 rows）────────────────────────────────────────────────────
  const rowEstimates: Estimate[] = [];

  const acH = autocorrelation(rowProjection, maxCellH);
  const acPeakH = findFirstACPeak(acH, MIN_CELL, maxCellH);
  if (acPeakH) {
    const count = Math.round(effectiveHeight / acPeakH);
    rowEstimates.push({ count, spacing: acPeakH, weight: 3.0, label: 'AC-row' });
  }

  const pkH = estimateByPeaks(rowProjection, effectiveHeight, MIN_CELL, maxCellH);
  if (pkH) {
    rowEstimates.push({ count: pkH.count, spacing: pkH.spacing, weight: 2.0, label: 'Peak-row' });
  }

  const fftH = estimateByFFT(rowProjection, effectiveHeight, MIN_CELL, maxCellH);
  if (fftH) {
    rowEstimates.push({
      count: fftH.count, spacing: fftH.spacing,
      weight: 1.0 + fftH.confidence, label: 'FFT-row',
    });
  }

  const rowResult = fuseEstimates(rowEstimates);

  // ── 格子尺寸（像素） ──────────────────────────────────────────────────────
  const cellW = colResult.spacing > 0
    ? colResult.spacing
    : (colResult.count > 0 ? effectiveWidth / colResult.count : MIN_CELL);
  const cellH = rowResult.spacing > 0
    ? rowResult.spacing
    : (rowResult.count > 0 ? effectiveHeight / rowResult.count : MIN_CELL);

  // ── confidence ────────────────────────────────────────────────────────────
  const methodLabel = `${colResult.label}+${rowResult.label}`;
  const confidence = Math.min(1,
    (colEstimates.length + rowEstimates.length) / 6,
  );

  return {
    cellW:  Math.round(cellW),
    cellH:  Math.round(cellH),
    cols:   Math.max(1, colResult.count),
    rows:   Math.max(1, rowResult.count),
    margin,
    confidence,
    method: methodLabel,
  };
}
