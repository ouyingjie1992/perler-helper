/**
 * imageProcessor.ts
 * 使用 sharp 进行专业图像处理：
 * - 支持更多格式（HEIC、TIFF 等）
 * - 专业 Unsharp Mask（基于 libvips）
 * - 精确像素提取和区域采样
 */
import sharp from 'sharp';

export interface RawImageData {
  data: Buffer;
  width: number;
  height: number;
  channels: number; // 3 = RGB
}

/** 从 base64 DataURL 解析图片，应用专业锐化，返回原始 RGB 像素 */
export async function loadAndSharpen(imageDataUrl: string): Promise<RawImageData> {
  const base64 = imageDataUrl.split(',')[1];
  const input = Buffer.from(base64, 'base64');

  const { data, info } = await sharp(input)
    .removeAlpha()
    // libvips Unsharp Mask：sigma=1.0 为模糊半径，m1=0 不增强已经清晰的区域，m2=2.0 为锐化强度
    // 远比手写 box-blur Unsharp Mask 精确
    .sharpen({ sigma: 1.0, m1: 0, m2: 2.0 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: data as Buffer, width: info.width, height: info.height, channels: info.channels };
}

/** 从 base64 DataURL 加载灰度图（用于网格检测，无需锐化） */
export async function loadGrayscale(imageDataUrl: string): Promise<{ data: Buffer; width: number; height: number }> {
  const base64 = imageDataUrl.split(',')[1];
  const input = Buffer.from(base64, 'base64');

  const { data, info } = await sharp(input)
    .grayscale()
    // 轻微模糊去除传感器噪声，让网格线投影更干净
    .blur(0.8)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: data as Buffer, width: info.width, height: info.height };
}

const FILTER_BRIGHT = 240; // 过滤白色背景
const FILTER_DARK   = 20;  // 过滤黑色描边/文字

/**
 * 采样矩形区域的平均颜色（过滤极亮/极暗像素），
 * 效果与前端 canvas 版本等价，但使用 sharp 解码的高质量 RGB 数据
 */
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
 * 计算行/列方向的亮度投影数组（供 gridAnalyzer 使用）
 * 返回每列/每行的平均灰度值
 */
export function computeProjections(
  { data, width, height }: { data: Buffer; width: number; height: number },
): { colProjection: number[]; rowProjection: number[] } {
  const colProj = new Array<number>(width).fill(0);
  const rowProj = new Array<number>(height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x]; // 单通道灰度值
      colProj[x] += v;
      rowProj[y] += v;
    }
  }

  for (let x = 0; x < width; x++)  colProj[x] /= height;
  for (let y = 0; y < height; y++) rowProj[y] /= width;

  return { colProjection: colProj, rowProjection: rowProj };
}
