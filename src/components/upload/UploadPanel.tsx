import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePerlerImage } from '../../utils/boardParser';
import { detectGrid } from '../../utils/gridDetector';
import { useBoardStore } from '../../store/boardStore';
import { PaletteSelector } from './PaletteSelector';
import { SavedProjects } from './SavedProjects';
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
  const hintItems = useBoardStore((s) => s.hintItems);
  const setHintItems = useBoardStore((s) => s.setHintItems);
  const clearHistory = useBoardStore((s) => s.clearHistory);
  const setCurrentProjectId = useBoardStore((s) => s.setCurrentProjectId);
  const commitBoard = useBoardStore((s) => s.commitBoard);

  // 所有已填数量的合计
  const hintTotal = hintItems.reduce((sum, h) => sum + (h.count ?? 0), 0);
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
  // ref 镜像（供原生触摸事件回调读取最新值）
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // ── 框选状态 ──────────────────────────────────────────────────────────────
  // selRect 始终是标准化的（x,y 为左上角，w,h≥0）canvas 像素坐标
  const [selRect, setSelRect] = useState<SelectRect | null>(null);
  const selRectRef = useRef<SelectRect | null>(null);
  const setSelRectBoth = (r: SelectRect | null) => { selRectRef.current = r; setSelRect(r); };
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
      // 手柄固定屏幕像素大小：目标 8px 屏幕 → canvas坐标 = 8 / zoom
      const hs = 8 / zoom;

      // 虚线框（线宽 1.5px 屏幕）
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      ctx.restore();

      // 实心角点手柄（方形）
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

      // 四边中点手柄（圆形，略小）
      const midHandles = [
        [n.x + n.w / 2, n.y            ],
        [n.x + n.w / 2, n.y + n.h      ],
        [n.x,           n.y + n.h / 2  ],
        [n.x + n.w,     n.y + n.h / 2  ],
      ];
      ctx.fillStyle = '#FFD700';
      for (const [hx, hy] of midHandles) {
        ctx.beginPath();
        ctx.arc(hx, hy, hs * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginTop, marginRight, marginBottom, marginLeft, gridCols, gridRows, selRect, zoom]);

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

    setSelRectBoth(nr);
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
      setSelRectBoth(null);
      return;
    }

    const nr = normalize(final);
    setSelRectBoth(nr);
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

  // ── 触摸事件（non-passive，支持 iPad 触屏框选/平移/缩放） ────────────────
  // 用 ref 包一层，让闭包内总能读到最新的工具函数
  const computeDraggedRectRef = useRef(computeDraggedRect);
  const applySelRectRef       = useRef(applySelRect);
  const drawPreviewRef        = useRef(drawPreview);
  useEffect(() => { computeDraggedRectRef.current = computeDraggedRect; }, [computeDraggedRect]);
  useEffect(() => { applySelRectRef.current       = applySelRect;       }, [applySelRect]);
  useEffect(() => { drawPreviewRef.current        = drawPreview;        }, [drawPreview]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // 将屏幕坐标转换为 canvas 坐标
    const toCanvasPos = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const wRect = wrapper.getBoundingClientRect();
      const wx    = clientX - wRect.left;
      const wy    = clientY - wRect.top;
      const cssW  = canvas.width  * zoomRef.current;
      const cssH  = canvas.height * zoomRef.current;
      return {
        x: ((wx - panRef.current.x) / cssW) * canvas.width,
        y: ((wy - panRef.current.y) / cssH) * canvas.height,
      };
    };

    let pinchDist: number | null = null;
    let touchPanStart: { mx: number; my: number; px: number; py: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 2) {
        // 双指：结束当前框选拖拽，准备捏合缩放 + 双指平移
        isDragging.current = false;
        dragStart.current  = null;
        const [a, b] = [e.touches[0], e.touches[1]];
        pinchDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        touchPanStart = {
          mx: (a.clientX + b.clientX) / 2,
          my: (a.clientY + b.clientY) / 2,
          px: panRef.current.x,
          py: panRef.current.y,
        };
        return;
      }

      if (e.touches.length === 1) {
        pinchDist = null;
        touchPanStart = null;
        const t = e.touches[0];
        const pos = toCanvasPos(t.clientX, t.clientY);

        // 命中测试：有选框时检测 handle，否则绘新框
        let handle: DragHandle = 'new';
        const cur = selRectRef.current;
        if (cur && cur.w > 0 && cur.h > 0) {
          handle = hitTest(cur, pos.x, pos.y, zoomRef.current);
        }

        dragHandle.current = handle;
        dragStart.current  = {
          px: pos.x, py: pos.y,
          rect: cur ? { ...cur } : { x: pos.x, y: pos.y, w: 0, h: 0 },
        };
        isDragging.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 2 && pinchDist !== null && touchPanStart !== null) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const newDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const ratio   = newDist / pinchDist;
        const midX    = (a.clientX + b.clientX) / 2;
        const midY    = (a.clientY + b.clientY) / 2;

        setZoom(prev => {
          const next = Math.max(0.2, Math.min(10, prev * ratio));
          const wRect = wrapper.getBoundingClientRect();
          const mx = midX - wRect.left;
          const my = midY - wRect.top;
          setPan(prevPan => ({
            x: mx - (mx - prevPan.x) * (next / prev) + (midX - touchPanStart!.mx) * 0,
            y: my - (my - prevPan.y) * (next / prev) + (midY - touchPanStart!.my) * 0,
          }));
          return next;
        });
        // 同时双指平移
        setPan(prevPan => ({
          x: prevPan.x + (midX - touchPanStart!.mx) * 0.15,
          y: prevPan.y + (midY - touchPanStart!.my) * 0.15,
        }));

        pinchDist = newDist;
        touchPanStart = { ...touchPanStart, mx: midX, my: midY };
        return;
      }

      if (e.touches.length === 1 && isDragging.current && dragStart.current) {
        const t   = e.touches[0];
        const pos = toCanvasPos(t.clientX, t.clientY);
        const nr  = computeDraggedRectRef.current(
          dragHandle.current,
          dragStart.current.rect,
          dragStart.current.px, dragStart.current.py,
          pos.x, pos.y,
        );
        setSelRectBoth(nr);
        drawPreviewRef.current(nr);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return; // 还有手指在屏幕上

      if (!isDragging.current || !dragStart.current) {
        pinchDist     = null;
        touchPanStart = null;
        return;
      }

      isDragging.current = false;
      const lastTouch = e.changedTouches[0];
      const pos = toCanvasPos(lastTouch.clientX, lastTouch.clientY);
      const final = computeDraggedRectRef.current(
        dragHandle.current,
        dragStart.current.rect,
        dragStart.current.px, dragStart.current.py,
        pos.x, pos.y,
      );
      dragStart.current = null;
      pinchDist         = null;
      touchPanStart     = null;

      if (dragHandle.current === 'new' && (final.w < 4 || final.h < 4)) {
        setSelRectBoth(null);
        return;
      }

      const nr = normalize(final);
      setSelRectBoth(nr);
      applySelRectRef.current(nr);
    };

    wrapper.addEventListener('touchstart', onTouchStart, { passive: false });
    wrapper.addEventListener('touchmove',  onTouchMove,  { passive: false });
    wrapper.addEventListener('touchend',   onTouchEnd,   { passive: false });
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove',  onTouchMove);
      wrapper.removeEventListener('touchend',   onTouchEnd);
    };
  // step 变化时重新注册（config 步骤才有 wrapperRef）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── 自动检测 ──────────────────────────────────────────────────────────────
  const runDetect = async (dataUrl: string, hintTotalRef?: number) => {
    setDetecting(true);
    setDetectInfo(null);
    try {
      const result = await detectGrid(dataUrl);

      // 如果用户填了数量合计，且合计与自动识别的格子数偏差 >10%，优先信任用户数据
      const autoTotal = result.cols * result.rows;
      const hint = hintTotalRef ?? 0;
      if (hint > 0 && Math.abs(hint - autoTotal) / autoTotal > 0.10) {
        // 保持自动识别的列数，按合计反推行数
        const adjustedRows = Math.max(1, Math.round(hint / result.cols));
        setGridCols(result.cols);
        setGridRows(adjustedRows);
        setDetectInfo(
          `自动识别：${result.cols}×${result.rows} 格` +
          `，依颜色数量合计（${hint} 格）调整为 ${result.cols}×${adjustedRows}` +
          `，单格约 ${result.cellW}×${result.cellH}px`
        );
      } else {
        setGridCols(result.cols);
        setGridRows(result.rows);
        const methodNote = (result as unknown as { method?: string }).method
          ? ` [${(result as unknown as { method: string }).method}]` : '';
        setDetectInfo(`自动识别：${result.cols}×${result.rows} 格，单格约 ${result.cellW}×${result.cellH}px${methodNote}`);
      }

      setMarginTop   (result.margin.top);
      setMarginRight (result.margin.right);
      setMarginBottom(result.margin.bottom);
      setMarginLeft  (result.margin.left);

      const img = imgRef.current;
      if (img) {
        const ds = drawScaleRef.current;
        const cw = img.naturalWidth  * ds;
        const ch = img.naturalHeight * ds;
        setSelRectBoth({
          x: result.margin.left  * ds,
          y: result.margin.top   * ds,
          w: cw - (result.margin.left + result.margin.right)  * ds,
          h: ch - (result.margin.top  + result.margin.bottom) * ds,
        });
      }
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
    setSelRectBoth(null);
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

  // ── margin/grid/zoom 变化重绘 ───────────────────────────────────────────
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gridCols, gridRows, marginTop, marginRight, marginBottom, marginLeft, zoom]);

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
        hintItems,
      );
      const board: PerlerBoard = {
        id: Date.now().toString(),
        name: '拼豆图纸',
        ...boardData,
        imageDataUrl: previewUrl,
        // 若用户指定了颜色提示，将 code 列表存入 board，供编辑时限制色板
        hintCodes: hintItems.length > 0 ? hintItems.map((h) => h.code) : undefined,
      };
      clearHistory();
      setCurrentProjectId(null); // 新解析，尚未保存
      setBoard(board);
      // 将初始解析结果作为首个历史快照（可 Undo 回到解析初始状态）
      commitBoard(board, '初始解析');
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
    setSelRectBoth(null);
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

        {/* 已保存项目列表 */}
        <div className={styles.savedSection}>
          <SavedProjects />
        </div>
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
            onClick={() => previewUrl && runDetect(previewUrl, hintTotal)}
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

          {/* 数量合计提示：当用户填了 count 时显示 */}
          {hintTotal > 0 && (() => {
            const currentTotal = gridCols * gridRows;
            const diff = Math.abs(hintTotal - currentTotal);
            const diffPct = currentTotal > 0 ? diff / currentTotal : 1;
            const mismatch = diffPct > 0.05; // 偏差 >5% 标黄警告
            return (
              <div className={`${styles.hintTotalBar} ${mismatch ? styles.hintTotalMismatch : styles.hintTotalOk}`}>
                <span>
                  颜色数量合计 <strong>{hintTotal}</strong> 格
                  {mismatch
                    ? `，当前设定 ${currentTotal} 格，偏差 ${Math.round(diffPct * 100)}%`
                    : `，与当前设定（${currentTotal} 格）吻合`
                  }
                </span>
                {mismatch && (
                  <button
                    className={styles.btnFillFromHint}
                    onClick={() => {
                      // 保持列数，根据合计反推行数（向上取整）
                      const newRows = Math.max(1, Math.round(hintTotal / gridCols));
                      setGridRows(newRows);
                    }}
                    title="根据数量合计调整行数（保持列数不变）"
                  >
                    按合计调整
                  </button>
                )}
              </div>
            );
          })()}
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
                onChange={(e) => { setMarginTop(Number(e.target.value)); setSelRectBoth(null); }}
                className={styles.smallInput} />
            </label>
            <div />
            <label className={styles.marginInput}><span>左</span>
              <input type="number" min={0} max={9999} value={marginLeft}
                onChange={(e) => { setMarginLeft(Number(e.target.value)); setSelRectBoth(null); }}
                className={styles.smallInput} />
            </label>
            <div className={styles.marginCenter}>图纸</div>
            <label className={styles.marginInput}><span>右</span>
              <input type="number" min={0} max={9999} value={marginRight}
                onChange={(e) => { setMarginRight(Number(e.target.value)); setSelRectBoth(null); }}
                className={styles.smallInput} />
            </label>
            <div />
            <label className={styles.marginInput}><span>下</span>
              <input type="number" min={0} max={9999} value={marginBottom}
                onChange={(e) => { setMarginBottom(Number(e.target.value)); setSelRectBoth(null); }}
                className={styles.smallInput} />
            </label>
            <div />
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>涉及颜色（可选）</h4>
          <p className={styles.sectionHint}>
            选择图纸中用到的颜色，可选填每种颜色的格子数量，帮助更精准识别
          </p>
          <PaletteSelector items={hintItems} onChange={setHintItems} />
        </section>

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
