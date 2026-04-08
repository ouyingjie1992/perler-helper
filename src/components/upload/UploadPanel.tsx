import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePerlerImage } from '../../utils/boardParser';
import { detectGrid } from '../../utils/gridDetector';
import { useBoardStore } from '../../store/boardStore';
import type { PerlerBoard } from '../../types';
import styles from './UploadPanel.module.css';

type Step = 'upload' | 'config';

const MAX_PREVIEW_W = 640;
const MAX_PREVIEW_H = 580;

// 命中测试容差（canvas 像素，与 zoom 无关）
const HIT_EDGE   = 8;   // 边缘拖拽区宽度
const HIT_CORNER = 12;  // 角点优先命中半径

interface SelectRect {
  x: number; y: number; w: number; h: number; // canvas 像素坐标，w/h 始终正值
}

// 将任意 w/h 符号的 SelectRect 标准化（x,y 为左上角，w,h>0）
function normalize(r: SelectRect): SelectRect {
  return {
    x: r.w >= 0 ? r.x : r.x + r.w,
    y: r.h >= 0 ? r.y : r.y + r.h,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

type DragHandle =
  | 'new'                                            // 空白处拖出新框
  | 'move'                                           // 整框平移
  | 'left' | 'right' | 'top' | 'bottom'             // 单边拖拽
  | 'topleft' | 'topright' | 'bottomleft' | 'bottomright'; // 角点

/** 在标准化矩形上做命中测试，返回 handle 类型 */
function hitTest(r: SelectRect, px: number, py: number, zoom: number): DragHandle {
  const n  = normalize(r);
  const x1 = n.x, y1 = n.y, x2 = n.x + n.w, y2 = n.y + n.h;
  // 将 canvas 像素容差转换到 zoom=1 的逻辑空间（容差本身就是 canvas 像素，无需缩放）
  const ec = HIT_CORNER;
  const ee = HIT_EDGE;

  // 角点（优先）
  if (px >= x1 - ec && px <= x1 + ec && py >= y1 - ec && py <= y1 + ec) return 'topleft';
  if (px >= x2 - ec && px <= x2 + ec && py >= y1 - ec && py <= y1 + ec) return 'topright';
  if (px >= x1 - ec && px <= x1 + ec && py >= y2 - ec && py <= y2 + ec) return 'bottomleft';
  if (px >= x2 - ec && px <= x2 + ec && py >= y2 - ec && py <= y2 + ec) return 'bottomright';

  // 四边
  const inX = px >= x1 - ee && px <= x2 + ee;
  const inY = py >= y1 - ee && py <= y2 + ee;
  if (inX && Math.abs(py - y1) <= ee) return 'top';
  if (inX && Math.abs(py - y2) <= ee) return 'bottom';
  if (inY && Math.abs(px - x1) <= ee) return 'left';
  if (inY && Math.abs(px - x2) <= ee) return 'right';

  // 内部整框平移
  if (px > x1 && px < x2 && py > y1 && py < y2) return 'move';

  return 'new';
}

/** 根据 handle 返回 CSS cursor 字符串 */
function handleCursor(h: DragHandle): string {
  switch (h) {
    case 'topleft':     return 'nw-resize';
    case 'topright':    return 'ne-resize';
    case 'bottomleft':  return 'sw-resize';
    case 'bottomright': return 'se-resize';
    case 'top':
    case 'bottom':      return 'ns-resize';
    case 'left':
    case 'right':       return 'ew-resize';
    case 'move':        return 'move';
    default:            return 'crosshair';
  }
}

export const UploadPanel: React.FC = () => {
  const setBoard = useBoardStore((s) => s.setBoard);
  const [loading, setLoading]     = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectInfo, setDetectInfo] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep]           = useState<Step>('upload');

  const [gridCols, setGridCols]       = useState(48);
  const [gridRows, setGridRows]       = useState(48);
  const [marginTop, setMarginTop]     = useState(0);
  const [marginRight, setMarginRight] = useState(0);
  const [marginBottom, setMarginBottom] = useState(0);
  const [marginLeft, setMarginLeft]   = useState(0);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef     = useRef<HTMLImageElement | null>(null);
  const drawScaleRef = useRef(1);

  // ── 视图缩放 & 平移 ───────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const isPanning       = useRef(false);
  const panStart        = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isSpaceDown     = useRef(false);

  // ── 框选状态 ──────────────────────────────────────────────────────────────
  // selRect 始终是标准化的（x,y 为左上角，w,h≥0）canvas 像素坐标
  const [selRect, setSelRect] = useState<SelectRect | null>(null);
  // 当前拖拽 handle
  const dragHandle   = useRef<DragHandle>('new');
  const dragStart    = useRef<{ px: number; py: number; rect: SelectRect } | null>(null);
  const isDragging   = useRef(false);
  // hover handle（用于实时更新 cursor）
  const [hoverHandle, setHoverHandle] = useState<DragHandle | null>(null);

  // ── 工具函数 ──────────────────────────────────────────────────────────────
  const getDrawScale = (img: HTMLImageElement) =>
    Math.min(MAX_PREVIEW_W / img.naturalWidth, MAX_PREVIEW_H / img.naturalHeight, 1);

  const canvas_w = () => canvasRef.current?.width  ?? 0;
  const canvas_h = () => canvasRef.current?.height ?? 0;

  // ── 绘制 canvas ───────────────────────────────────────────────────────────
  const drawPreview = useCallback((rectOverride?: SelectRect | null) => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    const ds  = drawScaleRef.current;

    canvas.width  = Math.round(img.naturalWidth  * ds);
    canvas.height = Math.round(img.naturalHeight * ds);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const ml = marginLeft   * ds;
    const mt = marginTop    * ds;
    const mr = marginRight  * ds;
    const mb = marginBottom * ds;
    const eW = canvas.width  - ml - mr;
    const eH = canvas.height - mt - mb;

    // 暗遮罩（有效区外）
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, mt);
    ctx.fillRect(0, mt + eH, canvas.width, canvas.height - mt - eH);
    ctx.fillRect(0, mt, ml, eH);
    ctx.fillRect(ml + eW, mt, canvas.width - ml - eW, eH);

    // 蓝色有效区框
    ctx.strokeStyle = 'rgba(30,144,255,1)';
    ctx.lineWidth   = 2 / ds;
    ctx.strokeRect(ml, mt, eW, eH);

    // 网格线
    if (eW > 0 && eH > 0 && gridCols > 0 && gridRows > 0) {
      const cW = eW / gridCols;
      const cH = eH / gridRows;

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth   = 0.5 / ds;
      ctx.beginPath();
      for (let c = 1; c < gridCols; c++) {
        if (c % 5 !== 0) { ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH); }
      }
      for (let r = 1; r < gridRows; r++) {
        if (r % 5 !== 0) { ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH); }
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,50,50,0.8)';
      ctx.lineWidth   = 1 / ds;
      ctx.beginPath();
      for (let c = 0; c <= gridCols; c += 5) {
        ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH);
      }
      for (let r = 0; r <= gridRows; r += 5) {
        ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH);
      }
      ctx.stroke();
    }

    // 黄色虚线选框（rectOverride 优先，否则用 state）
    const r = rectOverride !== undefined ? rectOverride : selRect;
    if (r && r.w > 0 && r.h > 0) {
      const n  = normalize(r);
      const hs = 7 / ds;   // 角点手柄大小

      // 虚线框
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth   = 2 / ds;
      ctx.setLineDash([6 / ds, 3 / ds]);
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      ctx.restore();

      // 实心角点手柄
      ctx.fillStyle = '#FFD700';
      const corners = [
        [n.x,        n.y       ],
        [n.x + n.w,  n.y       ],
        [n.x,        n.y + n.h ],
        [n.x + n.w,  n.y + n.h],
      ];
      for (const [hx, hy] of corners) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }

      // 四边中点手柄（小圆形）
      const midHandles = [
        [n.x + n.w / 2, n.y       ],
        [n.x + n.w / 2, n.y + n.h ],
        [n.x,           n.y + n.h / 2],
        [n.x + n.w,     n.y + n.h / 2],
      ];
      ctx.fillStyle = '#FFD700';
      for (const [hx, hy] of midHandles) {
        ctx.beginPath();
        ctx.arc(hx, hy, (hs * 0.6) / 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginTop, marginRight, marginBottom, marginLeft, gridCols, gridRows, selRect]);

  // ── canvas 坐标（考虑 zoom/pan）─────────────────────────────────────────
  const getCanvasPos = useCallback((e: React.MouseEvent | MouseEvent) => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return { x: 0, y: 0 };
    const wRect   = wrapper.getBoundingClientRect();
    const wx      = e.clientX - wRect.left;
    const wy      = e.clientY - wRect.top;
    const cssW    = canvas.width  * zoom;
    const cssH    = canvas.height * zoom;
    return {
      x: ((wx - pan.x) / cssW) * canvas.width,
      y: ((wy - pan.y) / cssH) * canvas.height,
    };
  }, [zoom, pan]);

  // ── 把 canvas 选框坐标转换回 margin（原图像素）──────────────────────────
  const applySelRect = useCallback((r: SelectRect) => {
    const ds = drawScaleRef.current;
    const cw = canvas_w();
    const ch = canvas_h();
    const n  = normalize(r);
    const x1 = Math.max(0, Math.min(n.x,        cw));
    const y1 = Math.max(0, Math.min(n.y,        ch));
    const x2 = Math.max(0, Math.min(n.x + n.w,  cw));
    const y2 = Math.max(0, Math.min(n.y + n.h,  ch));
    setMarginLeft  (Math.round(x1 / ds));
    setMarginTop   (Math.round(y1 / ds));
    setMarginRight (Math.round((cw - x2) / ds));
    setMarginBottom(Math.round((ch - y2) / ds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 根据 handle + 起始状态 + 当前鼠标位置计算新的 rect ──────────────────
  const computeDraggedRect = useCallback((
    handle: DragHandle,
    startRect: SelectRect,
    startPx: number, startPy: number,
    curPx: number,   curPy: number,
  ): SelectRect => {
    const dx = curPx - startPx;
    const dy = curPy - startPy;
    const { x, y, w, h } = startRect;
    const cw = canvas_w();
    const ch = canvas_h();

    let nx = x, ny = y, nw = w, nh = h;

    switch (handle) {
      case 'move':
        nx = Math.max(0, Math.min(cw - w, x + dx));
        ny = Math.max(0, Math.min(ch - h, y + dy));
        break;
      case 'left':
        nx = Math.max(0, Math.min(x + w - 4, x + dx));
        nw = w - (nx - x);
        break;
      case 'right':
        nw = Math.max(4, Math.min(cw - x, w + dx));
        break;
      case 'top':
        ny = Math.max(0, Math.min(y + h - 4, y + dy));
        nh = h - (ny - y);
        break;
      case 'bottom':
        nh = Math.max(4, Math.min(ch - y, h + dy));
        break;
      case 'topleft':
        nx = Math.max(0, Math.min(x + w - 4, x + dx));
        ny = Math.max(0, Math.min(y + h - 4, y + dy));
        nw = w - (nx - x);
        nh = h - (ny - y);
        break;
      case 'topright':
        ny = Math.max(0, Math.min(y + h - 4, y + dy));
        nw = Math.max(4, Math.min(cw - x, w + dx));
        nh = h - (ny - y);
        break;
      case 'bottomleft':
        nx = Math.max(0, Math.min(x + w - 4, x + dx));
        nw = w - (nx - x);
        nh = Math.max(4, Math.min(ch - y, h + dy));
        break;
      case 'bottomright':
        nw = Math.max(4, Math.min(cw - x, w + dx));
        nh = Math.max(4, Math.min(ch - y, h + dy));
        break;
      case 'new':
        nx = Math.min(startPx, curPx);
        ny = Math.min(startPy, curPy);
        nw = Math.abs(curPx - startPx);
        nh = Math.abs(curPy - startPy);
        break;
    }

    return { x: nx, y: ny, w: nw, h: nh };
  }, []);

  // ── 鼠标事件 ─────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (isSpaceDown.current || e.button === 1) {
      isPanning.current = true;
      panStart.current  = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      return;
    }

    if (e.button !== 0) return;

    const pos = getCanvasPos(e);

    // 命中测试：有选框时检测 handle，否则绘新框
    let handle: DragHandle = 'new';
    if (selRect && selRect.w > 0 && selRect.h > 0) {
      handle = hitTest(selRect, pos.x, pos.y, zoom);
    }

    dragHandle.current = handle;
    dragStart.current  = { px: pos.x, py: pos.y, rect: selRect ? { ...selRect } : { x: pos.x, y: pos.y, w: 0, h: 0 } };
    isDragging.current = true;
  }, [pan, getCanvasPos, selRect, zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({
        x: panStart.current.px + e.clientX - panStart.current.mx,
        y: panStart.current.py + e.clientY - panStart.current.my,
      });
      return;
    }

    const pos = getCanvasPos(e);

    // 更新 hover handle（用于 cursor）
    if (!isDragging.current) {
      if (selRect && selRect.w > 0 && selRect.h > 0) {
        setHoverHandle(hitTest(selRect, pos.x, pos.y, zoom));
      } else {
        setHoverHandle(null);
      }
    }

    if (!isDragging.current || !dragStart.current) return;

    const nr = computeDraggedRect(
      dragHandle.current,
      dragStart.current.rect,
      dragStart.current.px, dragStart.current.py,
      pos.x, pos.y,
    );

    setSelRect(nr);
    drawPreview(nr);
  }, [getCanvasPos, selRect, zoom, computeDraggedRect, drawPreview]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) { isPanning.current = false; return; }
    if (!isDragging.current || !dragStart.current) return;
    isDragging.current = false;

    const pos = getCanvasPos(e);
    const final = computeDraggedRect(
      dragHandle.current,
      dragStart.current.rect,
      dragStart.current.px, dragStart.current.py,
      pos.x, pos.y,
    );
    dragStart.current = null;

    // 丢弃太小的新框
    if (dragHandle.current === 'new' && (final.w < 4 || final.h < 4)) {
      setSelRect(null);
      return;
    }

    const nr = normalize(final);
    setSelRect(nr);
    applySelRect(nr);
  }, [getCanvasPos, computeDraggedRect, applySelRect]);

  // ── 滚轮缩放 ──────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(prev => {
      const next = Math.max(0.2, Math.min(10, prev * factor));
      const wrapper = wrapperRef.current;
      if (!wrapper) return next;
      const wRect = wrapper.getBoundingClientRect();
      const mx = e.clientX - wRect.left;
      const my = e.clientY - wRect.top;
      setPan(prevPan => ({
        x: mx - (mx - prevPan.x) * (next / prev),
        y: my - (my - prevPan.y) * (next / prev),
      }));
      return next;
    });
  }, []);

  // ── 键盘 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && step === 'config') { e.preventDefault(); isSpaceDown.current = true; }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') isSpaceDown.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [step]);

  // ── 适应屏幕 ──────────────────────────────────────────────────────────────
  const fitToScreen = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // ── 自动检测 ──────────────────────────────────────────────────────────────
  const runDetect = async (dataUrl: string) => {
    setDetecting(true);
    setDetectInfo(null);
    try {
      const result = await detectGrid(dataUrl);
      setGridCols(result.cols);
      setGridRows(result.rows);
      setMarginTop   (result.margin.top);
      setMarginRight (result.margin.right);
      setMarginBottom(result.margin.bottom);
      setMarginLeft  (result.margin.left);

      const img = imgRef.current;
      if (img) {
        const ds = drawScaleRef.current;
        const cw = img.naturalWidth  * ds;
        const ch = img.naturalHeight * ds;
        setSelRect({
          x: result.margin.left  * ds,
          y: result.margin.top   * ds,
          w: cw - (result.margin.left + result.margin.right)  * ds,
          h: ch - (result.margin.top  + result.margin.bottom) * ds,
        });
      }

      const methodNote = (result as unknown as { method?: string }).method
        ? ` [${(result as unknown as { method: string }).method}]` : '';
      setDetectInfo(`自动识别：${result.cols}×${result.rows} 格，单格约 ${result.cellW}×${result.cellH}px${methodNote}`);
    } catch {
      setDetectInfo('自动识别失败，请手动框选有效区域');
    } finally {
      setDetecting(false);
    }
  };

  // ── 图片加载 ──────────────────────────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setError(null);
    setSelRect(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreviewUrl(dataUrl);
      imgRef.current = null;
      setStep('config');
      setZoom(1);
      setPan({ x: 0, y: 0 });
      const img = new Image();
      img.onload = async () => {
        drawScaleRef.current = getDrawScale(img);
        imgRef.current = img;
        await runDetect(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.bmp', '.webp'] },
    maxFiles: 1,
  });

  // ── margin/grid 变化重绘 ──────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gridCols, gridRows, marginTop, marginRight, marginBottom, marginLeft]);

  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRect]);

  // ── 解析 ─────────────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!previewUrl) return;
    setLoading(true);
    setError(null);
    try {
      const boardData = await parsePerlerImage(
        previewUrl, gridCols, gridRows,
        { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
      );
      const board: PerlerBoard = {
        id: Date.now().toString(),
        name: '拼豆图纸',
        ...boardData,
        imageDataUrl: previewUrl,
      };
      setBoard(board);
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setPreviewUrl(null);
    setStep('upload');
    setError(null);
    setSelRect(null);
    imgRef.current = null;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // ── cursor 决策 ───────────────────────────────────────────────────────────
  const getCursor = (): string => {
    if (isPanning.current || isSpaceDown.current) return isPanning.current ? 'grabbing' : 'grab';
    if (isDragging.current) return handleCursor(dragHandle.current);
    if (hoverHandle !== null) return handleCursor(hoverHandle);
    return 'crosshair';
  };

  // ── Render: 上传步骤 ──────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div className={styles.uploadWrapper}>
        <div
          {...getRootProps()}
          className={`${styles.dropzone} ${isDragActive ? styles.active : ''}`}
        >
          <input {...getInputProps()} />
          <div className={styles.dropIcon}>
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
              <rect width="72" height="72" rx="16" fill="rgba(233,69,96,0.1)" />
              <path d="M36 16v28M24 32l12-12 12 12M16 52h40"
                stroke="#e94560" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className={styles.dropText}>
            {isDragActive ? '松开鼠标上传图纸' : '拖拽拼豆图纸到此处，或点击选择'}
          </p>
          <p className={styles.dropHint}>支持 PNG、JPG、BMP 等格式</p>
          <div className={styles.dropTips}>
            <span className={styles.tip}>支持 Mark、Hama 等品牌图纸</span>
            <span className={styles.tip}>解析后可手动修正色码</span>
          </div>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  // ── Render: 配置步骤 ──────────────────────────────────────────────────────
  return (
    <div className={styles.configPanel}>

      {/* 左：预览区 */}
      <div className={styles.previewArea}>

        {/* 缩放控制栏 */}
        <div className={styles.zoomBar}>
          <button className={styles.zoomBtn} onClick={() => setZoom(z => Math.max(0.2, z / 1.25))} title="缩小">−</button>
          <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button className={styles.zoomBtn} onClick={() => setZoom(z => Math.min(10, z * 1.25))} title="放大">+</button>
          <div className={styles.zoomDivider} />
          <button className={styles.zoomBtn} onClick={fitToScreen} title="适应屏幕">⊙</button>
          <span className={styles.zoomHint}>滚轮缩放 · 空格+拖动平移</span>
        </div>

        {/* canvas 容器 */}
        <div
          ref={wrapperRef}
          className={styles.canvasWrapper}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={(e) => {
            if (isDragging.current) handleMouseUp(e);
            if (isPanning.current) isPanning.current = false;
          }}
          style={{ cursor: getCursor() }}
        >
          <canvas
            ref={canvasRef}
            className={styles.previewCanvas}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          />
        </div>

        <p className={styles.previewHint}>
          <strong>拖拽框选</strong>有效区域 &nbsp;|&nbsp;
          <strong>拖拽选框边缘/角点</strong>微调 &nbsp;|&nbsp;
          蓝框 = 当前选区 &nbsp;|&nbsp; 红线 = 5×5 分块
        </p>
      </div>

      {/* 右：配置表单 */}
      <div className={styles.configForm}>

        <div className={styles.configTitleRow}>
          <h3 className={styles.configTitle}>图纸规格</h3>
          <button
            className={styles.btnRedetect}
            disabled={detecting || !previewUrl}
            onClick={() => previewUrl && runDetect(previewUrl)}
          >
            {detecting ? '识别中…' : '自动识别'}
          </button>
        </div>

        {detectInfo && <p className={styles.detectInfo}>{detectInfo}</p>}

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>格子数量（手动填写）</h4>
          <div className={styles.inputRow}>
            <label className={styles.inputGroup}>
              <span>列（宽）</span>
              <input type="number" min={1} max={500} value={gridCols}
                onChange={(e) => setGridCols(Math.max(1, Number(e.target.value)))}
                className={styles.numInput} />
            </label>
            <span className={styles.times}>×</span>
            <label className={styles.inputGroup}>
              <span>行（高）</span>
              <input type="number" min={1} max={500} value={gridRows}
                onChange={(e) => setGridRows(Math.max(1, Number(e.target.value)))}
                className={styles.numInput} />
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>边距（框选或手动输入）</h4>
          <p className={styles.sectionHint}>
            在左侧拖拽框选，也可拖拽选框<strong>边缘</strong>或<strong>角点</strong>精确微调，或直接输入像素值
          </p>
          <div className={styles.marginGrid}>
            <div />
            <label className={styles.marginInput}><span>上</span>
              <input type="number" min={0} max={9999} value={marginTop}
                onChange={(e) => { setMarginTop(Number(e.target.value)); setSelRect(null); }}
                className={styles.smallInput} />
            </label>
            <div />
            <label className={styles.marginInput}><span>左</span>
              <input type="number" min={0} max={9999} value={marginLeft}
                onChange={(e) => { setMarginLeft(Number(e.target.value)); setSelRect(null); }}
                className={styles.smallInput} />
            </label>
            <div className={styles.marginCenter}>图纸</div>
            <label className={styles.marginInput}><span>右</span>
              <input type="number" min={0} max={9999} value={marginRight}
                onChange={(e) => { setMarginRight(Number(e.target.value)); setSelRect(null); }}
                className={styles.smallInput} />
            </label>
            <div />
            <label className={styles.marginInput}><span>下</span>
              <input type="number" min={0} max={9999} value={marginBottom}
                onChange={(e) => { setMarginBottom(Number(e.target.value)); setSelRect(null); }}
                className={styles.smallInput} />
            </label>
            <div />
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={handleReset}>重新上传</button>
          <button className={styles.btnPrimary} onClick={handleConfirm} disabled={loading || detecting}>
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>

      </div>
    </div>
  );
};
