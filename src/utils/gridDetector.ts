/**
 * gridDetector.ts — 自动检测拼豆图纸网格规格
 *
 * 已升级：通过后端服务（perler-server）完成实际检测。
 * 后端使用 sharp 预处理图像，并用 Cooley-Tukey FFT 频域分析代替原来的局部极值众数法，
 * 对低分辨率/轻度倾斜图片的鲁棒性大幅提升。
 */

export interface GridDetectResult {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  confidence: number; // 0~1
}

const SERVER_URL = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? 'http://localhost:3001';

/**
 * 调用后端服务检测网格规格。
 * 后端使用 sharp 灰度化预处理 + FFT 频域分析，替代原来的局部极值众数法。
 */
export async function detectGrid(imageDataUrl: string): Promise<GridDetectResult> {
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
}

