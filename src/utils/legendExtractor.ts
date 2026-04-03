/**
 * 颜色采样工具
 * 提供锐化预处理 + 区域平均采样，供 boardParser 使用。
 */

export interface LegendSample {
  code: string;
  sampledHex: string;
  lab: [number, number, number];
}

/** RGB → CIE Lab */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const toLinear = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const rL = toLinear(r), gL = toLinear(g), bL = toLinear(b);
  const X = rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375;
  const Y = rL * 0.2126729 + gL * 0.7151522 + bL * 0.0721750;
  const Z = rL * 0.0193339 + gL * 0.1191920 + bL * 0.9503041;
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = (t: number) => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = [f(X / xn), f(Y / yn), f(Z / zn)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 色差（平方，省 sqrt 提速） */
export function labDistance(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/**
 * Unsharp Mask 锐化
 * sharpen = original + amount × (original − box_blur)
 */
export function unsharpMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount = 1.5,
  radius = 1,
): Uint8ClampedArray {
  const len = width * height * 4;
  const blurred = new Uint8ClampedArray(len);
  const r = radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const idx = (ny * width + nx) * 4;
          sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2];
          count++;
        }
      }
      const idx = (y * width + x) * 4;
      blurred[idx]     = sumR / count;
      blurred[idx + 1] = sumG / count;
      blurred[idx + 2] = sumB / count;
      blurred[idx + 3] = data[idx + 3];
    }
  }

  const result = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    result[i]     = Math.max(0, Math.min(255, data[i]     + amount * (data[i]     - blurred[i])));
    result[i + 1] = Math.max(0, Math.min(255, data[i + 1] + amount * (data[i + 1] - blurred[i + 1])));
    result[i + 2] = Math.max(0, Math.min(255, data[i + 2] + amount * (data[i + 2] - blurred[i + 2])));
    result[i + 3] = data[i + 3];
  }
  return result;
}

/**
 * 采样矩形区域的平均颜色，过滤掉极亮（白底）和极暗（文字/边框）像素
 */
export function sampleRegionAvg(
  data: Uint8ClampedArray,
  imgWidth: number,
  x0: number, y0: number,
  x1: number, y1: number,
  filterBright = 240,
  filterDark = 20,
): { r: number; g: number; b: number } | null {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= imgWidth) continue;
      const idx = (y * imgWidth + x) * 4;
      if (idx + 2 >= data.length) continue;
      const pr = data[idx], pg = data[idx + 1], pb = data[idx + 2];
      const brightness = (pr + pg + pb) / 3;
      if (brightness > filterBright || brightness < filterDark) continue;
      sumR += pr; sumG += pg; sumB += pb; count++;
    }
  }
  if (count === 0) return null;
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
}

/** 在图例样本中找 Lab 最近颜色 */
export function findBestMatch(
  r: number, g: number, b: number,
  legendSamples: LegendSample[],
): LegendSample | null {
  if (legendSamples.length === 0) return null;
  const lab = rgbToLab(r, g, b);
  let minDist = Infinity, best: LegendSample | null = null;
  for (const s of legendSamples) {
    const d = labDistance(lab, s.lab);
    if (d < minDist) { minDist = d; best = s; }
  }
  return best;
}
