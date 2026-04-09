/**
 * offlineParser.ts — 前端离线图片解析引擎
 *
 * 使用浏览器 Canvas API 复刻后端 sharp + culori 的核心功能：
 *  - sampleRegionDominant：众数池化采样（抗格线干扰）
 *  - findNearestColor：CIEDE2000 色彩匹配
 *  - parsePerlerImageOffline：完整图纸解析流程
 *
 * 无需网络连接，完全在设备端运行。
 */

import { MARK_COLOR_PALETTE, type MarkColor } from './markPalette';
import type { HintItem } from '../store/boardStore';
import type { PerlerBoard, PerlerCell, ColorStat } from '../types';

// ─── 颜色空间转换 ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** sRGB → 线性 RGB */
function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 线性 RGB → XYZ (D65) */
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = toLinear(r), gl = toLinear(g), bl = toLinear(b);
  return [
    rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
    rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750,
    rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041,
  ];
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  return xyzToLab(...rgbToXyz(r, g, b));
}

/** CIEDE2000 色差公式 */
function ciede2000(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const deg = (r: number) => r * 180 / Math.PI;
  const rad = (d: number) => d * Math.PI / 180;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cb = (C1 + C2) / 2;
  const Cb7 = Math.pow(Cb, 7);
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    dhp = Math.abs(diff) <= 180 ? diff : diff > 180 ? diff - 360 : diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = 0;
  if (C1p * C2p !== 0) {
    hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2
      : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos(rad(hbp - 30))
    + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6))
    - 0.20 * Math.cos(rad(4 * hbp - 63));

  const SL = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;

  const Cbp7 = Math.pow(Cbp, 7);
  const RT = -2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)))
    * Math.sin(rad(60 * Math.exp(-Math.pow((hbp - 275) / 25, 2))));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
    Math.pow(dCp / SC, 2) +
    Math.pow(dHp / SH, 2) +
    RT * (dCp / SC) * (dHp / SH)
  );
}

// ─── 预计算色卡 Lab 值（避免重复计算）─────────────────────────────────────────

interface PaletteEntry extends MarkColor {
  lab: [number, number, number];
}

let _cachedPalette: PaletteEntry[] | null = null;

function getPaletteLab(): PaletteEntry[] {
  if (_cachedPalette) return _cachedPalette;
  _cachedPalette = MARK_COLOR_PALETTE.map((c) => {
    const [r, g, b] = hexToRgb(c.hex);
    return { ...c, lab: rgbToLab(r, g, b) };
  });
  return _cachedPalette;
}

/** 从候选色列表中找到 CIEDE2000 最近的颜色 */
function findNearestColor(
  r: number, g: number, b: number,
  palette?: PaletteEntry[]
): MarkColor {
  const lab = rgbToLab(r, g, b);
  const candidates = palette ?? getPaletteLab();
  let bestDist = Infinity;
  let best = candidates[0];
  for (const c of candidates) {
    const d = ciede2000(...lab, ...c.lab);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ─── Canvas 图像采样 ──────────────────────────────────────────────────────────

/**
 * 众数池化：将区域 RGB 量化为 8 级（每通道），取最高频率桶的均值。
 * 与后端 sampleRegionDominant 算法完全一致，抗格线/阴影干扰。
 */
function sampleRegionDominant(
  data: Uint8ClampedArray,
  width: number,
  x0: number, y0: number, x1: number, y1: number
): [number, number, number] {
  const BINS = 8;
  const BIN_SIZE = 256 / BINS;

  // 三维桶：[rBin][gBin][bBin] = { count, sumR, sumG, sumB }
  const buckets: Array<{ count: number; sumR: number; sumG: number; sumB: number }> =
    Array.from({ length: BINS * BINS * BINS }, () => ({ count: 0, sumR: 0, sumG: 0, sumB: 0 }));

  const px0 = Math.max(0, Math.round(x0));
  const py0 = Math.max(0, Math.round(y0));
  const px1 = Math.min(width - 1, Math.round(x1));
  const py1 = Math.min(Math.floor(data.length / (width * 4)) - 1, Math.round(y1));

  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const rBin = Math.min(BINS - 1, Math.floor(r / BIN_SIZE));
      const gBin = Math.min(BINS - 1, Math.floor(g / BIN_SIZE));
      const bBin = Math.min(BINS - 1, Math.floor(b / BIN_SIZE));
      const idx = rBin * BINS * BINS + gBin * BINS + bBin;
      buckets[idx].count++;
      buckets[idx].sumR += r;
      buckets[idx].sumG += g;
      buckets[idx].sumB += b;
    }
  }

  let best = buckets[0];
  for (const bucket of buckets) {
    if (bucket.count > best.count) best = bucket;
  }

  if (best.count === 0) return [128, 128, 128];
  return [
    Math.round(best.sumR / best.count),
    Math.round(best.sumG / best.count),
    Math.round(best.sumB / best.count),
  ];
}

// ─── 加载图片到 Canvas ────────────────────────────────────────────────────────

interface ImageData2 {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function loadImageData(imageDataUrl: string): Promise<ImageData2> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 限制最大分辨率，避免内存压力（最长边 2000px）
      const MAX = 2000;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      resolve({ data: id.data, width: w, height: h });
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageDataUrl;
  });
}

// ─── 网格检测（前端简化版）────────────────────────────────────────────────────

export interface GridDetectResultOffline {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number;
}

/**
 * 前端离线网格检测（简化版）
 * 使用灰度投影 + 自相关法估算格子大小，精度略低于后端 FFT 版本。
 */
export async function detectGridOffline(imageDataUrl: string): Promise<GridDetectResultOffline> {
  const { data, width, height } = await loadImageData(imageDataUrl);

  // 计算灰度投影
  const colProj = new Float64Array(width);
  const rowProj = new Float64Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      colProj[x] += gray;
      rowProj[y] += gray;
    }
  }
  for (let x = 0; x < width; x++) colProj[x] /= height;
  for (let y = 0; y < height; y++) rowProj[y] /= width;

  // 自相关法估算周期
  function estimatePeriod(proj: Float64Array, len: number): number {
    const mean = proj.reduce((a, b) => a + b, 0) / len;
    const centered = Array.from(proj).map(v => v - mean);

    let bestPeriod = 8;
    let bestScore = -Infinity;

    for (let p = 6; p < len / 3; p++) {
      let score = 0;
      let count = 0;
      for (let i = 0; i + p < len; i++) {
        score += centered[i] * centered[i + p];
        count++;
      }
      if (count > 0 && score / count > bestScore) {
        bestScore = score / count;
        bestPeriod = p;
      }
    }
    return bestPeriod;
  }

  const cellW = estimatePeriod(colProj, width);
  const cellH = estimatePeriod(rowProj, height);
  const cols = Math.round(width / cellW);
  const rows = Math.round(height / cellH);

  return {
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    cellW,
    cellH,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    confidence: 0.6,
  };
}

// ─── 主解析函数（离线版）──────────────────────────────────────────────────────

/**
 * 前端离线图纸解析，完整流程：
 *  1. 加载图片到 Canvas
 *  2. 逐格众数池化采样
 *  3. CIEDE2000 最近色匹配
 *  4. 构建 colorStats
 */
export async function parsePerlerImageOffline(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
  hintItems: HintItem[] = [],
): Promise<Omit<PerlerBoard, 'id' | 'name'>> {
  const { data, width, height } = await loadImageData(imageDataUrl);

  // 有效区域
  const left = margin.left;
  const top = margin.top;
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const boardW = right - left;
  const boardH = bottom - top;

  const cellW = boardW / gridCols;
  const cellH = boardH / gridRows;

  // 候选色卡
  const fullPalette = getPaletteLab();
  const hintCodes = hintItems.map(h => h.code);
  const limitedPalette = hintCodes.length > 0
    ? fullPalette.filter(c => hintCodes.includes(c.code))
    : null;

  const cells: PerlerCell[] = [];
  const countMap: Record<string, number> = {};
  const hexMap: Record<string, string> = {};

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const x0 = left + col * cellW;
      const y0 = top + row * cellH;
      const x1 = x0 + cellW - 1;
      const y1 = y0 + cellH - 1;

      const [r, g, b] = sampleRegionDominant(data, width, x0, y0, x1, y1);
      const palette = limitedPalette && limitedPalette.length > 0 ? limitedPalette : fullPalette;
      const matched = findNearestColor(r, g, b, palette);

      cells.push({
        row,
        col,
        colorCode: matched.code,
        colorHex: matched.hex,
      });

      countMap[matched.code] = (countMap[matched.code] ?? 0) + 1;
      hexMap[matched.code] = matched.hex;
    }
  }

  // 构建 colorStats
  const colorStats: ColorStat[] = Object.entries(countMap)
    .map(([code, count]) => ({
      colorCode: code,
      colorHex: hexMap[code],
      count,
      cells: cells.filter(c => c.colorCode === code).map(c => ({ row: c.row, col: c.col })),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    rows: gridRows,
    cols: gridCols,
    cells,
    colorStats,
    imageDataUrl,
    margin,
  };
}
