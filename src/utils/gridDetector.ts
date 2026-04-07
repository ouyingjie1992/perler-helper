/**
 * gridDetector.ts — 自动检测拼豆图纸网格规格
 *
 * 算法（更鲁棒的极小值统计法）：
 *
 * 1. 计算行/列方向的亮度投影（每行/列的平均灰度）
 * 2. 平滑投影（消除噪声）
 * 3. 在投影中寻找"局部极小值"——格线是深色线，投影值在格线处偏低
 * 4. 收集相邻极小值的间距，用"最高频率间距"（众数）作为 cellSize
 * 5. 用第一条格线位置推算 margin
 * 6. effectiveSize / cellSize → rows/cols
 *
 * 如果格线是亮色（浅色）则改为找局部极大值。算法会自动判断。
 */

export interface GridDetectResult {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number; // 0~1
}

// ─── 图像加载 ─────────────────────────────────────────────────────────────────

function loadImageData(
  imageDataUrl: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ data: id.data, width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageDataUrl;
  });
}

// ─── 投影计算 ─────────────────────────────────────────────────────────────────

/** 每列的平均灰度 → 长度=width */
function colProjection(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const p = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    p[x] = s / h;
  }
  return p;
}

/** 每行的平均灰度 → 长度=height */
function rowProjection(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const p = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    p[y] = s / w;
  }
  return p;
}

// ─── 平滑 ─────────────────────────────────────────────────────────────────────

/** 均值平滑，radius=1~2 */
function smooth(arr: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, cnt = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j >= 0 && j < arr.length) { s += arr[j]; cnt++; }
    }
    out[i] = s / cnt;
  }
  return out;
}

// ─── 局部极值检测 ─────────────────────────────────────────────────────────────

/**
 * 寻找局部极小值（格线为暗色时使用）
 * halfWin: 比较窗口半径（像素），至少要在 ±halfWin 范围内是最小值
 * minDrop: 相对周围的最小下沉幅度（过滤噪声）
 */
function findLocalMinima(
  arr: Float32Array,
  halfWin: number,
  minDrop: number,
): number[] {
  const positions: number[] = [];
  for (let i = halfWin; i < arr.length - halfWin; i++) {
    let isMin = true;
    let neighborMax = -Infinity;
    for (let d = -halfWin; d <= halfWin; d++) {
      if (d === 0) continue;
      if (arr[i + d] < arr[i]) { isMin = false; break; }
      if (arr[i + d] > neighborMax) neighborMax = arr[i + d];
    }
    if (isMin && neighborMax - arr[i] >= minDrop) {
      positions.push(i);
    }
  }
  return positions;
}

/**
 * 寻找局部极大值（格线为亮色时使用）
 */
function findLocalMaxima(
  arr: Float32Array,
  halfWin: number,
  minRise: number,
): number[] {
  const positions: number[] = [];
  for (let i = halfWin; i < arr.length - halfWin; i++) {
    let isMax = true;
    let neighborMin = Infinity;
    for (let d = -halfWin; d <= halfWin; d++) {
      if (d === 0) continue;
      if (arr[i + d] > arr[i]) { isMax = false; break; }
      if (arr[i + d] < neighborMin) neighborMin = arr[i + d];
    }
    if (isMax && arr[i] - neighborMin >= minRise) {
      positions.push(i);
    }
  }
  return positions;
}

// ─── 间距众数 ─────────────────────────────────────────────────────────────────

/**
 * 给定一组极值位置，计算相邻间距，
 * 返回出现最多的间距值（即 cellSize）及其出现次数。
 * 允许 ±tolerance 的容差合并相近间距。
 */
function dominantSpacing(
  positions: number[],
  tolerance: number = 1,
): { spacing: number; votes: number } {
  if (positions.length < 2) return { spacing: 0, votes: 0 };

  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    gaps.push(positions[i] - positions[i - 1]);
  }

  // 也考虑隔一个的间距（应对偶尔漏检）
  for (let i = 2; i < positions.length; i++) {
    const g = positions[i] - positions[i - 2];
    if (g < gaps[0] * 2.5) gaps.push(Math.round(g / 2)); // 折半
  }

  // 统计众数（桶统计，容差合并）
  const buckets = new Map<number, number>();
  for (const g of gaps) {
    const key = Math.round(g / tolerance) * tolerance;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  let bestSpacing = 0, bestVotes = 0;
  for (const [k, v] of buckets) {
    if (v > bestVotes && k > 2) { // 过滤掉太小的间距
      bestVotes = v;
      bestSpacing = k;
    }
  }

  return { spacing: bestSpacing, votes: bestVotes };
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

export async function detectGrid(imageDataUrl: string): Promise<GridDetectResult> {
  const { data, width, height } = await loadImageData(imageDataUrl);

  // 判断格线颜色：格线通常是比格子内部更暗的线
  // 通过全图平均亮度和标准差来决定用极小值还是极大值
  // 先直接试极小值（对深色格线图纸），若检测失败再试极大值

  const cProj = smooth(colProjection(data, width, height), 1);
  const rProj = smooth(rowProjection(data, width, height), 1);

  // 自适应阈值：投影值的标准差的 15%
  const stdDev = (arr: Float32Array): number => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  };

  const minDropW = stdDev(cProj) * 0.15;
  const minDropH = stdDev(rProj) * 0.15;

  // 搜索窗口：最小格子 3px，最大格子 图像尺寸/3
  const minCell = 3;
  const halfWinW = Math.max(2, Math.floor(width / (2 * 200))); // 假设至少 5 格
  const halfWinH = Math.max(2, Math.floor(height / (2 * 200)));

  let colPositions = findLocalMinima(cProj, Math.max(halfWinW, 2), minDropW);
  let rowPositions = findLocalMinima(rProj, Math.max(halfWinH, 2), minDropH);

  // 如果极小值太少，尝试更小的窗口（格子较大时）
  if (colPositions.length < 3) {
    colPositions = findLocalMinima(cProj, 1, minDropW * 0.5);
  }
  if (rowPositions.length < 3) {
    rowPositions = findLocalMinima(rProj, 1, minDropH * 0.5);
  }

  // 计算主导间距
  let { spacing: cellW, votes: votesW } = dominantSpacing(colPositions);
  let { spacing: cellH, votes: votesH } = dominantSpacing(rowPositions);

  // 如果间距检测失败，尝试用极大值（浅色格线）
  if (cellW < minCell || votesW < 2) {
    const maxRiseW = stdDev(cProj) * 0.15;
    const altCol = findLocalMaxima(cProj, 2, maxRiseW);
    const alt = dominantSpacing(altCol);
    if (alt.spacing >= minCell && alt.votes >= 2) { cellW = alt.spacing; votesW = alt.votes; }
  }
  if (cellH < minCell || votesH < 2) {
    const maxRiseH = stdDev(rProj) * 0.15;
    const altRow = findLocalMaxima(rProj, 2, maxRiseH);
    const alt = dominantSpacing(altRow);
    if (alt.spacing >= minCell && alt.votes >= 2) { cellH = alt.spacing; votesH = alt.votes; }
  }

  // 最终保底：若还是检测不到，使用整图 ÷ 假定 48 格
  if (cellW < minCell) cellW = Math.round(width / 48);
  if (cellH < minCell) cellH = Math.round(height / 48);

  // ── 确定 margin ──
  // 第一条极值在哪里
  const firstCol = colPositions.length > 0 ? colPositions[0] : 0;
  const firstRow = rowPositions.length > 0 ? rowPositions[0] : 0;

  // 如果第一条格线距离边缘超过半个格子，说明有 margin
  const marginLeft = firstCol > cellW * 0.5 ? firstCol : (firstCol > 2 ? firstCol : 0);
  const marginTop = firstRow > cellH * 0.5 ? firstRow : (firstRow > 2 ? firstRow : 0);

  // 右/下边 margin：镜像逻辑
  const lastCol = colPositions.length > 0 ? colPositions[colPositions.length - 1] : width - 1;
  const lastRow = rowPositions.length > 0 ? rowPositions[rowPositions.length - 1] : height - 1;
  const marginRight = (width - 1 - lastCol) > cellW * 0.5 ? (width - 1 - lastCol) : 0;
  const marginBottom = (height - 1 - lastRow) > cellH * 0.5 ? (height - 1 - lastRow) : 0;

  // ── rows / cols ──
  const effectiveW = width - marginLeft - marginRight;
  const effectiveH = height - marginTop - marginBottom;
  const cols = Math.max(1, Math.round(effectiveW / cellW));
  const rows = Math.max(1, Math.round(effectiveH / cellH));

  // ── 可信度 ──
  // 以极值数量 / 预期格子数 衡量
  const expectedCols = cols;
  const expectedRows = rows;
  const confW = Math.min(1, colPositions.length / Math.max(1, expectedCols - 1));
  const confH = Math.min(1, rowPositions.length / Math.max(1, expectedRows - 1));
  const confidence = (confW + confH) / 2;

  return {
    cellW,
    cellH,
    cols,
    rows,
    margin: {
      top: marginTop,
      right: marginRight,
      bottom: marginBottom,
      left: marginLeft,
    },
    confidence,
  };
}
