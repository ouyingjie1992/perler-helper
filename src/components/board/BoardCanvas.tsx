import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useBoardStore } from '../../store/boardStore';
import { darkenColor } from '../../utils/boardParser';
import type { PerlerBoard } from '../../types';
import styles from './BoardCanvas.module.css';

interface BoardCanvasProps {
  board: PerlerBoard;
}

type RenderMode = 'color' | 'overlay';
type ToolMode = 'pan' | 'select';

interface SelectionRect {
  x: number; y: number; w: number; h: number;
}

export const BoardCanvas: React.FC<BoardCanvasProps> = ({ board }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const { selectedColorCode, toggleSelectedColor, setSelectedColorCode, setEditingColorCode, cellSize, showGrid, rotateBoard, focusMode } = useBoardStore();

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [renderMode, setRenderMode] = useState<RenderMode>('color');
  const [toolMode, setToolMode] = useState<ToolMode>('pan');
  const [imgLoaded, setImgLoaded] = useState(false);

  // ── 交互状态（用 ref 存储以便在原生事件回调中访问最新值） ────────────────
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const toolModeRef = useRef(toolMode);
  const cellSizeRef = useRef(cellSize);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { toolModeRef.current = toolMode; }, [toolMode]);
  useEffect(() => { cellSizeRef.current = cellSize; }, [cellSize]);

  // 平移
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // 框选
  const selStart = useRef<{ canvasX: number; canvasY: number } | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);
  const [selection, setSelectionState] = useState<SelectionRect | null>(null);
  const setSelection = useCallback((s: SelectionRect | null) => {
    selectionRef.current = s;
    setSelectionState(s);
  }, []);
  // 拖动判断
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const setDragging = (v: boolean) => { isDraggingRef.current = v; setIsDragging(v); };
  // 长按
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const [isLongPress, setIsLongPressState] = useState(false);
  const setIsLongPress = (v: boolean) => { isLongPressRef.current = v; setIsLongPressState(v); };
  // 双指缩放
  const pinchRef = useRef<{ dist: number } | null>(null);

  // cellMap ref（供原生事件回调用）
  const cellMapRef = useRef(new Map<string, { colorCode: string; colorHex: string }>());

  // 预加载原图
  useEffect(() => {
    if (board.imageDataUrl) {
      const img = new Image();
      img.onload = () => { imgRef.current = img; setImgLoaded(true); };
      img.src = board.imageDataUrl;
    } else {
      imgRef.current = null;
      setImgLoaded(false);
    }
  }, [board.imageDataUrl]);

  // 构建快速查询 Map
  const cellMap = useMemo(() => {
    const map = new Map<string, { colorCode: string; colorHex: string }>();
    for (const cell of board.cells) {
      map.set(`${cell.row},${cell.col}`, { colorCode: cell.colorCode, colorHex: cell.colorHex });
    }
    cellMapRef.current = map;
    return map;
  }, [board.cells]);

  // store 方法的 ref（供原生事件用）
  const toggleSelectedColorRef = useRef(toggleSelectedColor);
  const setSelectedColorCodeRef = useRef(setSelectedColorCode);
  const setEditingColorCodeRef = useRef(setEditingColorCode);
  useEffect(() => { toggleSelectedColorRef.current = toggleSelectedColor; }, [toggleSelectedColor]);
  useEffect(() => { setSelectedColorCodeRef.current = setSelectedColorCode; }, [setSelectedColorCode]);
  useEffect(() => { setEditingColorCodeRef.current = setEditingColorCode; }, [setEditingColorCode]);

  // selectedColorCode ref（供原生事件读取最新高亮色）
  const selectedColorCodeRef = useRef(selectedColorCode);
  useEffect(() => { selectedColorCodeRef.current = selectedColorCode; }, [selectedColorCode]);

  // board 尺寸 ref
  const boardRef = useRef(board);
  useEffect(() => { boardRef.current = board; }, [board]);

  // ── 绘制 ──────────────────────────────────────────────────────────────────
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

    const isHighlighted = (r: number, c: number): boolean => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      return cellMap.get(`${r},${c}`)?.colorCode === selectedColorCode;
    };

    const drawCellSeparators = () => {
      if (!hasSelection) return;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!isHighlighted(r, c)) continue;
          const x = c * cs, y = r * cs;
          if (isHighlighted(r, c + 1)) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); }
          if (isHighlighted(r + 1, c)) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); }
        }
      }
      ctx.stroke();
    };

    if (renderMode === 'overlay' && imgRef.current && imgLoaded) {
      const img = imgRef.current;
      const m = board.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const srcEffW = img.naturalWidth - m.left - m.right;
      const srcEffH = img.naturalHeight - m.top - m.bottom;
      const srcCellW = srcEffW / cols;
      const srcCellH = srcEffH / rows;
      ctx.drawImage(img, m.left, m.top, srcEffW, srcEffH, 0, 0, totalW, totalH);
      if (hasSelection) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, totalW, totalH);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = cellMap.get(`${r},${c}`);
            if (cell?.colorCode === selectedColorCode) {
              const x = c * cs, y = r * cs;
              ctx.drawImage(img, m.left + c * srcCellW, m.top + r * srcCellH, srcCellW, srcCellH, x, y, cs, cs);
              ctx.strokeStyle = 'rgba(255, 220, 0, 0.8)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
            }
          }
        }
        drawCellSeparators();
      }
    } else {
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
      drawCellSeparators();
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

    if (showGrid) {
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
      ctx.strokeStyle = hasSelection ? 'rgba(255, 40, 40, 0.95)' : 'rgba(255, 40, 40, 0.75)';
      ctx.lineWidth = hasSelection ? 1.5 : 1;
      ctx.beginPath();
      for (let r = 0; r <= rows; r += 5) { ctx.moveTo(0, r * cs); ctx.lineTo(totalW, r * cs); }
      for (let c = 0; c <= cols; c += 5) { ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, totalH); }
      ctx.stroke();
      if (cs >= 14) {
        ctx.font = `${Math.max(8, cs * 0.28)}px monospace`;
        ctx.fillStyle = 'rgba(255, 80, 80, 0.6)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const bCols = Math.ceil(cols / 5);
        const bRows = Math.ceil(rows / 5);
        for (let br = 0; br < bRows; br++) {
          for (let bc = 0; bc < bCols; bc++) {
            ctx.fillText(`${br * bCols + bc + 1}`, bc * 5 * cs + 2, br * 5 * cs + 1);
          }
        }
      }
    }
  }, [board, cellSize, selectedColorCode, showGrid, cellMap, renderMode, imgLoaded]);

  useEffect(() => { draw(); }, [draw]);

  // ── 坐标转换（纯函数，用 ref 值） ─────────────────────────────────────────
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { cx: 0, cy: 0 };
    const rect = container.getBoundingClientRect();
    const originX = 20 + offsetRef.current.x;
    const originY = 20 + offsetRef.current.y;
    const cx = (clientX - rect.left - originX) / scaleRef.current;
    const cy = (clientY - rect.top - originY) / scaleRef.current;
    return { cx, cy };
  }, []);

  // ── 框选完成 ──────────────────────────────────────────────────────────────
  const commitSelection = useCallback((sel: SelectionRect) => {
    if (sel.w <= 5 || sel.h <= 5) return;
    const cs = cellSizeRef.current;
    const b = boardRef.current;
    const colStart = Math.max(0, Math.floor(sel.x / cs));
    const rowStart = Math.max(0, Math.floor(sel.y / cs));
    const colEnd = Math.min(b.cols - 1, Math.floor((sel.x + sel.w) / cs));
    const rowEnd = Math.min(b.rows - 1, Math.floor((sel.y + sel.h) / cs));
    const counts = new Map<string, number>();
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const cell = cellMapRef.current.get(`${r},${c}`);
        if (cell) counts.set(cell.colorCode, (counts.get(cell.colorCode) ?? 0) + 1);
      }
    }
    if (counts.size > 0) {
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      setSelectedColorCodeRef.current(dominant);
    }
  }, []);

  // ── 原生触摸事件（non-passive，可调用 preventDefault） ────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // 阻止 iOS 长按弹出系统菜单
      e.preventDefault();

      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      setIsLongPress(false);

      if (e.touches.length === 2) {
        panStart.current = null;
        selStart.current = null;
        downPos.current = null;
        setSelection(null);
        const [a, b] = [e.touches[0], e.touches[1]];
        pinchRef.current = { dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) };
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        downPos.current = { x: t.clientX, y: t.clientY };
        setDragging(false);
        pinchRef.current = null;

        if (toolModeRef.current === 'select') {
          const { cx, cy } = screenToCanvas(t.clientX, t.clientY);
          selStart.current = { canvasX: cx, canvasY: cy };
          setSelection(null);
        } else {
          // pan 模式
          panStart.current = { x: t.clientX, y: t.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
          // 长按 500ms → 进入框选
          longPressTimer.current = setTimeout(() => {
            if (downPos.current) {
              setIsLongPress(true);
              const { cx, cy } = screenToCanvas(downPos.current.x, downPos.current.y);
              selStart.current = { canvasX: cx, canvasY: cy };
              setSelection(null);
              panStart.current = null;
            }
          }, 500);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 2 && pinchRef.current) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const newDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const ratio = newDist / pinchRef.current.dist;
        setScale((s) => Math.max(0.1, Math.min(10, s * ratio)));
        pinchRef.current = { dist: newDist };
        return;
      }

      if (e.touches.length !== 1 || !downPos.current) return;
      const t = e.touches[0];
      const dx = t.clientX - downPos.current.x;
      const dy = t.clientY - downPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 移动 > 8px 取消长按
      if (dist > 8 && longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      if (toolModeRef.current === 'select' || isLongPressRef.current) {
        if (selStart.current) {
          const { cx, cy } = screenToCanvas(t.clientX, t.clientY);
          const sx = selStart.current.canvasX;
          const sy = selStart.current.canvasY;
          setDragging(true);
          setSelection({
            x: Math.min(sx, cx), y: Math.min(sy, cy),
            w: Math.abs(cx - sx), h: Math.abs(cy - sy),
          });
        }
      } else if (panStart.current) {
        if (!isDraggingRef.current && dist > 6) setDragging(true);
        if (isDraggingRef.current) {
          setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }

      if (toolModeRef.current === 'select' || isLongPressRef.current) {
        const sel = selectionRef.current;
        if (sel) commitSelection(sel);
        selStart.current = null;
        setSelection(null);
        setIsLongPress(false);
        setDragging(false);
      } else {
        // pan 模式：未拖动 → 单击
        if (!isDraggingRef.current && e.changedTouches.length === 1 && downPos.current) {
          const t = e.changedTouches[0];
          const { cx, cy } = screenToCanvas(t.clientX, t.clientY);
          const cs = cellSizeRef.current;
          const col = Math.floor(cx / cs);
          const row = Math.floor(cy / cs);
          const cell = cellMapRef.current.get(`${row},${col}`);
          if (cell) {
            // 已高亮该色且点击了高亮格 → 打开编辑弹窗
            if (selectedColorCodeRef.current === cell.colorCode) {
              setEditingColorCodeRef.current(cell.colorCode);
            } else {
              toggleSelectedColorRef.current(cell.colorCode);
            }
          } else {
            setSelectedColorCodeRef.current(null);
          }
        }
        panStart.current = null;
        setDragging(false);
      }
      downPos.current = null;
      pinchRef.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  // 只在 mount/unmount 时注册一次，内部通过 ref 读取最新状态
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenToCanvas, commitSelection]);

  // ── 鼠标事件（保留，桌面端用） ────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    downPos.current = { x: e.clientX, y: e.clientY };
    setDragging(false);
    if (toolMode === 'select') {
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      selStart.current = { canvasX: cx, canvasY: cy };
      setSelection(null);
    } else {
      panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  }, [toolMode, offset, screenToCanvas, setSelection]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    if (toolMode === 'select' && selStart.current && downPos.current) {
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      const sx = selStart.current.canvasX, sy = selStart.current.canvasY;
      setDragging(true);
      setSelection({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
    } else if (toolMode === 'pan' && panStart.current && downPos.current) {
      const dx = e.clientX - downPos.current.x;
      const dy = e.clientY - downPos.current.y;
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 4) setDragging(true);
      if (isDragging) setOffset({ x: panStart.current.ox + e.clientX - panStart.current.x, y: panStart.current.oy + e.clientY - panStart.current.y });
    }
  }, [toolMode, isDragging, screenToCanvas, setSelection]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (toolMode === 'select') {
      const sel = selectionRef.current;
      if (sel) commitSelection(sel);
      selStart.current = null;
      setSelection(null);
      setDragging(false);
    } else {
      const moved = isDragging;
      panStart.current = null;
      setDragging(false);
      if (!moved) {
        const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
        const col = Math.floor(cx / cellSize);
        const row = Math.floor(cy / cellSize);
        const cell = cellMap.get(`${row},${col}`);
        if (cell) {
          // 已高亮该色且点击了高亮格 → 打开编辑弹窗
          if (selectedColorCode === cell.colorCode) {
            setEditingColorCode(cell.colorCode);
          } else {
            toggleSelectedColor(cell.colorCode);
          }
        } else {
          setSelectedColorCode(null);
        }
      }
    }
    downPos.current = null;
  }, [toolMode, isDragging, commitSelection, screenToCanvas, cellSize, cellMap, selectedColorCode, toggleSelectedColor, setSelectedColorCode, setEditingColorCode, setSelection]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); }, []);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.1, Math.min(10, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  const handleReset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  // 选框屏幕位置
  const selectionStyle = useMemo(() => {
    if (!selection) return null;
    const originX = 20 + offset.x;
    const originY = 20 + offset.y;
    return {
      left: selection.x * scale + originX,
      top: selection.y * scale + originY,
      width: selection.w * scale,
      height: selection.h * scale,
    };
  }, [selection, offset, scale]);

  const cursorStyle = toolMode === 'select' ? 'crosshair' : (isDragging ? 'grabbing' : 'grab');

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        panStart.current = null;
        downPos.current = null;
        selStart.current = null;
        setDragging(false);
        setIsLongPress(false);
        if (toolMode !== 'select') setSelection(null);
      }}
      onContextMenu={handleContextMenu}
      // 触摸事件由 useEffect 原生注册（non-passive），JSX 不绑定
    >
      <div
        className={styles.canvasWrapper}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          cursor: cursorStyle,
        }}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      {selectionStyle && (
        <div className={styles.selectionRect} style={selectionStyle} />
      )}

      {/* 控制栏：专注模式下隐藏 */}
      {!focusMode && (
        <div className={styles.controls}>
          <div className={styles.modeSwitch}>
            <button className={`${styles.modeBtn} ${renderMode === 'color' ? styles.modeActive : ''}`} onClick={() => setRenderMode('color')} title="色块模式">色块</button>
            <button className={`${styles.modeBtn} ${renderMode === 'overlay' ? styles.modeActive : ''}`} onClick={() => setRenderMode('overlay')} title="叠加原图模式" disabled={!board.imageDataUrl}>原图</button>
          </div>

          <div className={styles.divider} />

          <button className={styles.ctrlBtn} onClick={rotateBoard} title="顺时针旋转 90°">↻</button>

          <div className={styles.divider} />

          <button
            className={`${styles.ctrlBtn} ${toolMode === 'select' ? styles.ctrlBtnActive : ''}`}
            onClick={() => setToolMode((m) => m === 'select' ? 'pan' : 'select')}
            title={toolMode === 'select' ? '退出框选（当前激活）' : '进入框选模式'}
          >⬚</button>

          <div className={styles.divider} />

          <button onClick={() => setScale((s) => Math.min(10, s * 1.25))} className={styles.ctrlBtn} title="放大">+</button>
          <button onClick={() => setScale((s) => Math.max(0.1, s * 0.8))} className={styles.ctrlBtn} title="缩小">−</button>
          <button onClick={handleReset} className={styles.ctrlBtn} title="重置视图">⊙</button>
          <span className={styles.scaleLabel}>{Math.round(scale * 100)}%</span>
        </div>
      )}

      {/* hint 文字：专注模式下隐藏 */}
      {!focusMode && (
        <div className={styles.hint}>
          {isLongPress
            ? '长按框选中，松手确认...'
            : toolMode === 'select'
              ? '框选模式：拖拽选框 → 高亮主色 · 点⬚退出'
              : selectedColorCode
                ? '单击高亮格 → 修改色值 · 单击其他格 → 切换高亮 · ⬚框选'
                : '单击格子高亮颜色 · 拖拽平移 · 长按拖拽框选 · ⬚切换框选'}
        </div>
      )}
    </div>
  );
};
