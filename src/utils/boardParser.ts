import type { PerlerBoard } from '../types';
import type { HintItem } from '../store/boardStore';
import { parsePerlerImageOffline, parsePerlerImageSimple, type SimplePixelationMode } from './offlineParser';

export type { SimplePixelationMode };

const SERVER_URL = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? '';

// ─── 后端可用性检测 ───────────────────────────────────────────────────────────

let _serverAvailable: boolean | null = null;

async function checkServerAvailable(): Promise<boolean> {
  if (_serverAvailable !== null) return _serverAvailable;
  try {
    const res = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    _serverAvailable = res.ok;
  } catch {
    _serverAvailable = false;
  }
  return _serverAvailable;
}

/** 强制重置后端可用性缓存（下次调用重新检测） */
export function resetServerAvailability() {
  _serverAvailable = null;
}

// ─── 主解析函数（自动降级）────────────────────────────────────────────────────

/**
 * 解析拼豆图纸。
 * - 优先调用后端（sharp + culori CIEDE2000，精度更高）
 * - 后端不可用时自动降级到前端离线 Canvas 解析
 *
 * @param hintItems 用户填写的涉及颜色列表（可含数量）
 */
export async function parsePerlerImage(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
  hintItems: HintItem[] = [],
): Promise<Omit<PerlerBoard, 'id' | 'name'>> {
  const serverOk = await checkServerAvailable();

  if (serverOk) {
    try {
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
    } catch (e) {
      console.warn('[Parser] 后端解析失败，降级到离线模式:', e);
      // 后端失败时降级
    }
  }

  // 离线模式
  console.info('[Parser] 使用前端离线解析引擎');
  return parsePerlerImageOffline(imageDataUrl, gridCols, gridRows, margin, hintItems);
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

// ─── 简易解析函数（perler-beads-master 算法，纯前端离线）────────────────────

/**
 * 简易图纸解析，始终在前端 Canvas 运行，不调用后端。
 * 适合对精度要求不高、希望快速得到结果的场景。
 *
 * @param mode           采样模式：'dominant'（主导色）| 'average'（均值）
 * @param mergeThreshold 相似色合并阈值（0~441）：0=不合并，30=轻度，80=强力
 */
export async function parsePerlerImageSimpleMode(
  imageDataUrl: string,
  gridCols: number,
  gridRows: number,
  margin: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
  hintItems: HintItem[] = [],
  mode: SimplePixelationMode = 'dominant',
  mergeThreshold = 30,
): Promise<Omit<PerlerBoard, 'id' | 'name'>> {
  return parsePerlerImageSimple(imageDataUrl, gridCols, gridRows, margin, hintItems, mode, mergeThreshold);
}
