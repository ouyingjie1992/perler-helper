/**
 * colorMatcher.ts
 * 使用 culori 库实现专业色彩匹配：
 * - CIEDE2000 (ΔE2000) 色差公式，比原来手写的 CIE76 精确得多
 * - culori v4 的 differenceCiede2000 完全支持 Lab、OKLab、sRGB 等色彩空间，精度经过大量验证
 */
import { differenceCiede2000, converter } from 'culori';

export interface MarkColor {
  code: string;
  name: string;
  hex: string;
}

/** Mark 拼豆色卡（与前端 markPalette.ts 保持同步） */
const MARK_COLOR_PALETTE: MarkColor[] = [
  // ===== E 系列：米白/肤色/浅棕系 =====
  { code: 'E16', name: '极浅米肤',  hex: '#F5E6D8' },
  { code: 'E15', name: '浅米肤',    hex: '#EDCFB5' },
  { code: 'E14', name: '中浅肤',    hex: '#E3BC9A' },
  { code: 'E13', name: '中肤',      hex: '#D4A07A' },
  { code: 'E11', name: '浅棕肤',    hex: '#C48860' },
  { code: 'E08', name: '浅橙肤',    hex: '#E8A875' },
  { code: 'E07', name: '奶油橙',    hex: '#F2C398' },
  { code: 'E04', name: '浅橘',      hex: '#F0AA70' },
  { code: 'E02', name: '奶白',      hex: '#F8EEE0' },
  { code: 'E01', name: '米白',      hex: '#FAE8D5' },
  { code: 'E00', name: '棉花白',    hex: '#FFF5EE' },
  // ===== F 系列：棕红/玫瑰棕/深棕系 =====
  { code: 'F1',  name: '浅粉棕',    hex: '#EDCAAE' },
  { code: 'F3',  name: '粉棕',      hex: '#E0AE90' },
  { code: 'F5',  name: '中玫瑰棕',  hex: '#C87860' },
  { code: 'F6',  name: '深玫瑰棕',  hex: '#B86050' },
  { code: 'F8',  name: '暖棕红',    hex: '#A85045' },
  { code: 'F10', name: '橙棕红',    hex: '#B85535' },
  { code: 'F11', name: '深红棕',    hex: '#8C3828' },
  { code: 'F12', name: '暗红棕',    hex: '#7D2E22' },
  { code: 'F13', name: '极深红棕',  hex: '#6A241C' },
  { code: 'F14', name: '浅棕玫瑰',  hex: '#D8906C' },
  { code: 'F19', name: '橙红棕',    hex: '#C05530' },
  { code: 'F20', name: '浅橙棕',    hex: '#DCA870' },
  // ===== A 系列：橙色系 =====
  { code: 'A7',  name: '亮橙',      hex: '#E87030' },
  { code: 'A14', name: '浅橙棕',    hex: '#D88848' },
  { code: 'A19', name: '深橙棕',    hex: '#B84820' },
  // ===== G 系列：金/黄棕系 =====
  { code: 'G19', name: '暖金棕',    hex: '#B87830' },
  // ===== H 系列：米黄/沙色系 =====
  { code: 'H2',  name: '浅沙米',    hex: '#E8D4A8' },
  { code: 'H4',  name: '沙棕',      hex: '#D4B880' },
  { code: 'H8',  name: '深沙棕',    hex: '#B89058' },
  // ===== M 系列：桃粉/肉色系 =====
  { code: 'M4',  name: '桃粉肉',    hex: '#EDBA98' },
  // B 蓝色系
  { code: 'B12', name: '天蓝',      hex: '#6BAED6' },
  { code: 'B14', name: '浅蓝',      hex: '#9ECAE1' },
  { code: 'B24', name: '深蓝',      hex: '#2171B5' },
  { code: 'B01', name: '纯蓝',      hex: '#4292C6' },
  // C 黄色系
  { code: 'C1',  name: '柠檬黄',    hex: '#FEE391' },
  { code: 'C5',  name: '中黄',      hex: '#FEC44F' },
  { code: 'C8',  name: '深黄',      hex: '#FE9929' },
  // D 绿色系
  { code: 'D15', name: '浅绿',      hex: '#A1D99B' },
  { code: 'D18', name: '草绿',      hex: '#41AB5D' },
  { code: 'D9',  name: '深绿',      hex: '#238443' },
  { code: 'D1',  name: '嫩绿',      hex: '#C7E9C0' },
  // P 紫色系
  { code: 'P3',  name: '浅紫',      hex: '#BCBDDC' },
  { code: 'P6',  name: '紫色',      hex: '#9E9AC8' },
  { code: 'P9',  name: '深紫',      hex: '#6A51A3' },
  // R 粉红系
  { code: 'R1',  name: '浅粉',      hex: '#FCC5C0' },
  { code: 'R3',  name: '粉红',      hex: '#F768A1' },
  { code: 'R6',  name: '玫红',      hex: '#DD3497' },
  // N 黑白灰
  { code: 'N1',  name: '纯白',      hex: '#FFFFFF' },
  { code: 'N2',  name: '浅灰',      hex: '#D9D9D9' },
  { code: 'N3',  name: '中灰',      hex: '#AAAAAA' },
  { code: 'N5',  name: '深灰',      hex: '#636363' },
  { code: 'N9',  name: '黑色',      hex: '#1A1A1A' },
];

// culori 的 converter 和 differenceDe2000
const toRgb = converter('rgb');

// CIEDE2000 差值函数（culori 返回 ΔE2000，范围约 0-100）
const de2000 = differenceCiede2000();

/** 将 hex 颜色转换为 culori RGB 对象 */
function hexToRgbObj(hex: string) {
  return toRgb(hex)!;
}

/** 预计算色板的 culori RGB 表示，避免每次匹配时重复转换 */
const PALETTE_WITH_RGB = MARK_COLOR_PALETTE.map((color) => ({
  ...color,
  rgbObj: hexToRgbObj(color.hex),
}));

export interface LegendSampleInput {
  code: string;
  sampledHex: string;
}

/**
 * 使用 CIEDE2000 找到最接近的颜色
 * CIEDE2000 在感知均匀性上远优于前端原来的 CIE76（平方欧氏距离），
 * 对于人眼难以区分的颜色对（如肤色系），准确率显著提升
 *
 * @param r 0-255
 * @param g 0-255
 * @param b 0-255
 * @param legendSamples 可选：用户手动标注的图例样本，优先匹配
 */
export function findNearestColor(
  r: number, g: number, b: number,
  legendSamples: LegendSampleInput[] = [],
): { code: string; hex: string } {
  const input = { mode: 'rgb' as const, r: r / 255, g: g / 255, b: b / 255 };

  // 优先在图例样本中匹配
  if (legendSamples.length > 0) {
    let minDist = Infinity;
    let bestSample = legendSamples[0];
    for (const s of legendSamples) {
      const sampleRgb = toRgb(s.sampledHex);
      if (!sampleRgb) continue;
      const d = de2000(input, sampleRgb);
      if (d < minDist) { minDist = d; bestSample = s; }
    }
    // 如果图例样本匹配足够好（ΔE < 25），使用图例颜色
    if (minDist < 25) {
      return { code: bestSample.code, hex: bestSample.sampledHex };
    }
  }

  // 在色板中找最近颜色（CIEDE2000）
  let minDist = Infinity;
  let best = PALETTE_WITH_RGB[0];
  for (const p of PALETTE_WITH_RGB) {
    const d = de2000(input, p.rgbObj);
    if (d < minDist) { minDist = d; best = p; }
  }

  return { code: best.code, hex: best.hex };
}
