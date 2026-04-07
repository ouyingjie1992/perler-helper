/**
 * legendExtractor.ts
 * 图例采样工具（供图例标注 UI 使用）
 *
 * 注意：色彩转换和色差计算已迁移至后端（server/src/utils/colorMatcher.ts），
 * 使用 culori 库的 CIEDE2000 实现，精度远优于原来的手写 CIE76。
 */

/** 图例颜色样本（传给后端 /api/parse-image） */
export interface LegendSample {
  code: string;
  sampledHex: string; // 从图例区域采样得到的十六进制颜色
}

/**
 * 从 canvas 像素数据中采样矩形区域的平均颜色，
 * 过滤掉极亮（白底）和极暗（描边/文字）像素
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

