/**
 * gridDetector.ts — 自动检测拼豆图纸网格规格
 *
 * 优先调用后端服务（sharp + FFT 频域分析）；
 * 后端不可用时自动降级到前端离线版（灰度投影 + 自相关法）。
 */

import { detectGridOffline, type GridDetectResultOffline } from './offlineParser';

export interface GridDetectResult {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number; // 0~1
}

const SERVER_URL = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? '';

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

/**
 * 检测网格规格（自动降级）。
 * - 后端可用：调用 /api/detect-grid（sharp + FFT，精度高）
 * - 后端不可用：前端离线检测（灰度投影 + 自相关，精度中等）
 */
export async function detectGrid(imageDataUrl: string): Promise<GridDetectResult> {
  const serverOk = await checkServerAvailable();

  if (serverOk) {
    try {
      const resp = await fetch(`${SERVER_URL}/api/detect-grid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `服务器错误 ${resp.status}`);
      }

      return resp.json() as Promise<GridDetectResult>;
    } catch (e) {
      console.warn('[GridDetect] 后端检测失败，降级到离线模式:', e);
    }
  }

  console.info('[GridDetect] 使用前端离线网格检测');
  const result: GridDetectResultOffline = await detectGridOffline(imageDataUrl);
  return result;
}
