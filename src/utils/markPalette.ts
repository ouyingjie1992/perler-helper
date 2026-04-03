/**
 * Mark 拼豆色卡数据库
 * 根据官方色卡图像精确校对颜色值
 */

export interface MarkColor {
  code: string;
  name: string;
  hex: string;
}

/**
 * Mark 色卡完整数据
 * 重点精准收录图纸中常见的肤色/棕色/橙色系列
 * 
 * 颜色来源：Mark Pony Bead 官方色卡目视调色
 */
export const MARK_COLOR_PALETTE: MarkColor[] = [
  // ===== E 系列：米白/肤色/浅棕系 =====
  { code: 'E16', name: '极浅米肤',  hex: '#F5E6D8' },  // 最浅，接近白肤
  { code: 'E15', name: '浅米肤',    hex: '#EDCFB5' },  // 浅肤
  { code: 'E14', name: '中浅肤',    hex: '#E3BC9A' },  // 中浅肤
  { code: 'E13', name: '中肤',      hex: '#D4A07A' },  // 中肤
  { code: 'E11', name: '浅棕肤',    hex: '#C48860' },  // 偏棕
  { code: 'E08', name: '浅橙肤',    hex: '#E8A875' },
  { code: 'E07', name: '奶油橙',    hex: '#F2C398' },
  { code: 'E04', name: '浅橘',      hex: '#F0AA70' },
  { code: 'E02', name: '奶白',      hex: '#F8EEE0' },
  { code: 'E01', name: '米白',      hex: '#FAE8D5' },
  { code: 'E00', name: '棉花白',    hex: '#FFF5EE' },

  // ===== F 系列：棕红/玫瑰棕/深棕系 =====
  { code: 'F1',  name: '浅粉棕',    hex: '#EDCAAE' },  // 图中最浅的F，接近E系
  { code: 'F3',  name: '粉棕',      hex: '#E0AE90' },
  { code: 'F5',  name: '中玫瑰棕',  hex: '#C87860' },  // 图中明显的中深玫瑰棕
  { code: 'F6',  name: '深玫瑰棕',  hex: '#B86050' },  // 较深的棕红
  { code: 'F8',  name: '暖棕红',    hex: '#A85045' },
  { code: 'F10', name: '橙棕红',    hex: '#B85535' },  // 偏橙红的棕
  { code: 'F11', name: '深红棕',    hex: '#8C3828' },  // 图中深色区域
  { code: 'F12', name: '暗红棕',    hex: '#7D2E22' },  // 更深
  { code: 'F13', name: '极深红棕',  hex: '#6A241C' },  // 最深的棕红
  { code: 'F14', name: '浅棕玫瑰',  hex: '#D8906C' },  // 介于E14和F5之间
  { code: 'F19', name: '橙红棕',    hex: '#C05530' },  // 偏橙的棕红
  { code: 'F20', name: '浅橙棕',    hex: '#DCA870' },  // 浅金橙

  // ===== A 系列：橙色系 =====
  { code: 'A7',  name: '亮橙',      hex: '#E87030' },  // 鲜艳橙色
  { code: 'A14', name: '浅橙棕',    hex: '#D88848' },  // 浅金橙
  { code: 'A19', name: '深橙棕',    hex: '#B84820' },  // 深橙，接近棕

  // ===== G 系列：金/黄棕系 =====
  { code: 'G19', name: '暖金棕',    hex: '#B87830' },  // 金棕色

  // ===== H 系列：米黄/沙色系 =====
  { code: 'H2',  name: '浅沙米',    hex: '#E8D4A8' },  // 浅米黄/沙色
  { code: 'H4',  name: '沙棕',      hex: '#D4B880' },
  { code: 'H8',  name: '深沙棕',    hex: '#B89058' },

  // ===== M 系列：桃粉/肉色系 =====
  { code: 'M4',  name: '桃粉肉',    hex: '#EDBA98' },  // 肉粉色，介于E14和F14之间

  // ===== 其他常见颜色 =====
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

// 建立快速查询 Map
export const colorMap = new Map<string, MarkColor>(
  MARK_COLOR_PALETTE.map((c) => [c.code.toUpperCase(), c])
);

/**
 * 根据颜色编码获取颜色信息
 * 若找不到则生成一个基于编码的默认颜色
 */
export function getMarkColor(code: string): MarkColor {
  const upper = code.toUpperCase().trim();
  const found = colorMap.get(upper);
  if (found) return found;

  // 兜底：根据字母生成色相，根据数字生成亮度
  const letter = upper.replace(/[^A-Z]/g, '')[0] || 'N';
  const num = parseInt(upper.replace(/[^0-9]/g, '') || '10', 10);
  const hue = ((letter.charCodeAt(0) - 65) * 26) % 360;
  const lightness = Math.max(30, Math.min(80, 80 - num * 1.5));
  return {
    code: upper,
    name: upper,
    hex: hslToHex(hue, 40, lightness),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
