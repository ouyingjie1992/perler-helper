import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useBoardStore } from '../../store/boardStore';
import { darkenColor } from '../../utils/boardParser';
import type { PerlerBoard } from '../../types';
import styles from './BoardCanvas.module.css';

interface BoardCanvasProps {
  board: PerlerBoard;
}

type RenderMode = 'color' | 'overlay';

export const BoardCanvas: React.FC<BoardCanvasProps> = ({ board }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { selectedColorCode, cellSize, showGrid } = useBoardStore();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [renderMode, setRenderMode] = useState<RenderMode>('color');
  const [imgLoaded, setImgLoaded] = useState(false);

  // 预加载原始图片
  useEffect(() => {
    if (board.imageDataUrl) {
      const img = new Image();
      img.onload = () => { imgRef.current = img; setImgLoaded(true); };
      img.src = board.imageDataUrl;
    }
  }, [board.imageDataUrl]);

  // 构建快速查询 Map：(row,col) -> cell
  const cellMap = useMemo(() => {
    const map = new Map<string, { colorCode: string; colorHex: string }>();
    for (const cell of board.cells) {
      map.set(`${cell.row},${cell.col}`, { colorCode: cell.colorCode, colorHex: cell.colorHex });
    }
    return map;
  }, [board.cells]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rows, cols } = board;
    const cs = cellSize;
    const totalW = cols * cs;
    const totalH = rows * cs;
    canvas.width = totalW;
    canvas.height = totalH;

    const hasSelection = selectedColorCode !== null;

    // 判断某格子是否是当前高亮颜色
    const isHighlighted = (r: number, c: number): boolean => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      const cell = cellMap.get(`${r},${c}`);
      return cell?.colorCode === selectedColorCode;
    };

    // 在高亮格子内部的相邻边上绘制分隔线（仅两侧均为高亮时才画）
    const drawCellSeparators = () => {
      if (!hasSelection) return;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!isHighlighted(r, c)) continue;
          const x = c * cs, y = r * cs;
          // 右侧边：当前格与右邻均高亮
          if (isHighlighted(r, c + 1)) {
            ctx.moveTo(x + cs, y);
            ctx.lineTo(x + cs, y + cs);
          }
          // 下侧边：当前格与下邻均高亮
          if (isHighlighted(r + 1, c)) {
            ctx.moveTo(x, y + cs);
            ctx.lineTo(x + cs, y + cs);
          }
        }
      }
      ctx.stroke();
    };

    if (renderMode === 'overlay' && imgRef.current && imgLoaded) {
      // ── 叠加模式：用 margin 正确裁切原图后绘制 ──
      const img = imgRef.current;
      const m = board.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
      // 原图中有效区域的像素范围
      const srcEffW = img.naturalWidth - m.left - m.right;
      const srcEffH = img.naturalHeight - m.top - m.bottom;
      const srcCellW = srcEffW / cols;
      const srcCellH = srcEffH / rows;

      // 背景：把有效区域拉伸铺满整个 canvas
      ctx.drawImage(img, m.left, m.top, srcEffW, srcEffH, 0, 0, totalW, totalH);

      if (hasSelection) {
        // 整体加一层暗色半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, totalW, totalH);

        // 高亮选中颜色的格子（从有效区域还原对应原图像素）
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = cellMap.get(`${r},${c}`);
            if (cell?.colorCode === selectedColorCode) {
              const x = c * cs, y = r * cs;
              const srcX = m.left + c * srcCellW;
              const srcY = m.top + r * srcCellH;
              ctx.drawImage(img, srcX, srcY, srcCellW, srcCellH, x, y, cs, cs);
              // 高亮边框
              ctx.strokeStyle = 'rgba(255, 220, 0, 0.8)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
            }
          }
        }

        // 在相邻高亮格之间画分隔线
        drawCellSeparators();
      }
    } else {
      // ── 颜色块模式：用 Mark 色卡颜色填充格子 ──
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = cellMap.get(`${r},${c}`);
          const x = c * cs, y = r * cs;
          if (!cell) {
            ctx.fillStyle = hasSelection ? '#080810' : '#141422';
            ctx.fillRect(x, y, cs, cs);
          } else {
            const isHL = !hasSelection || cell.colorCode === selectedColorCode;
            ctx.fillStyle = isHL ? cell.colorHex : darkenColor(cell.colorHex, 0.1);
            ctx.fillRect(x, y, cs, cs);
          }
        }
      }

      // 在相邻高亮格之间画分隔线（颜色块模式）
      drawCellSeparators();

      // 颜色块模式下文字
      if (cs >= 18) {
        ctx.font = `bold ${Math.max(7, Math.floor(cs * 0.32))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const cell of board.cells) {
          if (hasSelection && cell.colorCode !== selectedColorCode) continue;
          const x = cell.col * cs + cs / 2;
          const y = cell.row * cs + cs / 2;
          const rr = parseInt(cell.colorHex.slice(1, 3), 16);
          const gg = parseInt(cell.colorHex.slice(3, 5), 16);
          const bb = parseInt(cell.colorHex.slice(5, 7), 16);
          const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
          ctx.fillStyle = lum > 0.5 ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.7)';
          ctx.fillText(cell.colorCode, x, y);
        }
      }
    }

    // ── 网格线（两种模式都画）──
    if (showGrid) {
      // 普通细线
      if (cs >= 6) {
        ctx.strokeStyle = hasSelection ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let r = 1; r < rows; r++) {
          if (r % 5 !== 0) { ctx.moveTo(0, r * cs); ctx.lineTo(totalW, r * cs); }
        }
        for (let c = 1; c < cols; c++) {
          if (c % 5 !== 0) { ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, totalH); }
        }
        ctx.stroke();
      }

      // 5×5 红线
      ctx.strokeStyle = hasSelection ? 'rgba(255, 40, 40, 0.95)' : 'rgba(255, 40, 40, 0.75)';
      ctx.lineWidth = hasSelection ? 1.5 : 1;
      ctx.beginPath();
      for (let r = 0; r <= rows; r += 5) {
        ctx.moveTo(0, r * cs); ctx.lineTo(totalW, r * cs);
      }
      for (let c = 0; c <= cols; c += 5) {
        ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, totalH);
      }
      ctx.stroke();

      // 5×5 区块编号（当 cellSize 足够大时）
      if (cs >= 14) {
        ctx.font = `${Math.max(8, cs * 0.28)}px monospace`;
        ctx.fillStyle = 'rgba(255, 80, 80, 0.6)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const bCols = Math.ceil(cols / 5);
        const bRows = Math.ceil(rows / 5);
        for (let br = 0; br < bRows; br++) {
          for (let bc = 0; bc < bCols; bc++) {
            const bx = bc * 5 * cs + 2;
            const by = br * 5 * cs + 1;
            ctx.fillText(`${br * bCols + bc + 1}`, bx, by);
          }
        }
      }
    }
  }, [board, cellSize, selectedColorCode, showGrid, cellMap, renderMode, imgLoaded]);

  useEffect(() => { draw(); }, [draw]);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.1, Math.min(10, s * delta)));
  }, []);

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setOffset({
      x: panStart.current.ox + e.clientX - panStart.current.x,
      y: panStart.current.oy + e.clientY - panStart.current.y,
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleReset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  return (
    <div
      className={styles.container}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className={styles.canvasWrapper}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      {/* 控制栏 */}
      <div className={styles.controls}>
        {/* 渲染模式切换 */}
        <div className={styles.modeSwitch}>
          <button
            className={`${styles.modeBtn} ${renderMode === 'color' ? styles.modeActive : ''}`}
            onClick={() => setRenderMode('color')}
            title="色块模式：用 Mark 色卡颜色填充"
          >
            色块
          </button>
          <button
            className={`${styles.modeBtn} ${renderMode === 'overlay' ? styles.modeActive : ''}`}
            onClick={() => setRenderMode('overlay')}
            title="叠加模式：在原图上显示高亮"
            disabled={!board.imageDataUrl}
          >
            原图
          </button>
        </div>
        <div className={styles.divider} />
        <button onClick={() => setScale((s) => Math.min(10, s * 1.25))} className={styles.ctrlBtn} title="放大">+</button>
        <button onClick={() => setScale((s) => Math.max(0.1, s * 0.8))} className={styles.ctrlBtn} title="缩小">−</button>
        <button onClick={handleReset} className={styles.ctrlBtn} title="重置视图">⊙</button>
        <span className={styles.scaleLabel}>{Math.round(scale * 100)}%</span>
      </div>
    </div>
  );
};
