import type { PerlerBoard } from '../types';
import type { HintItem } from '../store/boardStore';

const SERVER_URL = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? 'http://localhost:3001';

// ─── 主解析函数 ───────────────────────────────────────────────────────────────

/**
 * 将图纸图片发送到后端解析。
 * 后端使用 sharp（professional unsharp mask）+ culori CIEDE2000 色彩匹配。
 *
 * @param hintItems 用户填写的涉及颜色列表（可含数量），非空时后端缩小匹配范围
 */
export async function parsePerlerImage(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
  hintItems: HintItem[] = [],
): Promise<Omit<PerlerBoard, 'id' | 'name'>> {
  const resp = await fetch(`${SERVER_URL}/api/parse-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, gridCols, gridRows, margin, hintItems }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `服务器错误 ${resp.status}`);
  }

  const data = await resp.json() as Omit<PerlerBoard, 'id' | 'name' | 'imageDataUrl' | 'margin'>;
  return { ...data, imageDataUrl, margin };
}

// ─── 颜色工具 ────────────────────────────────────────────────────────────────

export function darkenColor(hex: string, factor: number = 0.15): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? '#000000' : '#ffffff';
}

