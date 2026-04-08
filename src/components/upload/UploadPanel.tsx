import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePerlerImage } from '../../utils/boardParser';
import { detectGrid } from '../../utils/gridDetector';
import { useBoardStore } from '../../store/boardStore';
import type { PerlerBoard } from '../../types';
import styles from './UploadPanel.module.css';

type Step = 'upload' | 'config';

// canvas 内容的初始最大显示尺寸（用于计算初始缩放）
const MAX_PREVIEW_W = 640;
const MAX_PREVIEW_H = 580;

interface SelectRect {
  x: number; y: number; w: number; h: number; // canvas 像素坐标
}

export const UploadPanel: React.FC = () => {
  const setBoard = useBoardStore((s) => s.setBoard);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectInfo, setDetectInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('upload');

  const [gridCols, setGridCols] = useState(48);
  const [gridRows, setGridRows] = useState(48);
  const [marginTop, setMarginTop] = useState(0);
  const [marginRight, setMarginRight] = useState(0);
  const [marginBottom, setMarginBottom] = useState(0);
  const [marginLeft, setMarginLeft] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // canvas px / 原图 px 的固定绘制比（由图片大小和 MAX 决定，不随缩放变化）
  const drawScaleRef = useRef(1);

  // ── 视图缩放 & 平移（CSS transform，不影响 canvas 内容）──────────────────────
  const [zoom, setZoom] = useState(1);          // CSS 缩放倍数
  const [pan, setPan] = useState({ x: 0, y: 0 }); // CSS 平移 px
  const isPanning = useRef(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isSpaceDown = useRef(false);

  // ── 框选 ─────────────────────────────────────────────────────────────────────
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<SelectRect | null>(null);
  const isDragging = useRef(false);

  // ── 计算初始绘制缩放比 ────────────────────────────────────────────────────────
  const getDrawScale = (img: HTMLImageElement) =>
    Math.min(MAX_PREVIEW_W / img.naturalWidth, MAX_PREVIEW_H / img.naturalHeight, 1);

  // ── 绘制预览 canvas ──────────────────────────────────────────────────────────
  const drawPreview = useCallback((rect?: SelectRect | null) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d')!;

    const ds = drawScaleRef.current;
    canvas.width = Math.round(img.naturalWidth * ds);
    canvas.height = Math.round(img.naturalHeight * ds);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const ml = marginLeft * ds;
    const mt = marginTop * ds;
    const mr = marginRight * ds;
    const mb = marginBottom * ds;
    const eW = canvas.width - ml - mr;
    const eH = canvas.height - mt - mb;

    // 选区外暗遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, mt);
    ctx.fillRect(0, mt + eH, canvas.width, canvas.height - mt - eH);
    ctx.fillRect(0, mt, ml, eH);
    ctx.fillRect(ml + eW, mt, canvas.width - ml - eW, eH);

    // 蓝色有效区域框
    ctx.strokeStyle = 'rgba(30,144,255,1)';
    ctx.lineWidth = 2 / ds; // 视觉上保持 ~2px
    ctx.strokeRect(ml, mt, eW, eH);

    // 网格线
    if (eW > 0 && eH > 0 && gridCols > 0 && gridRows > 0) {
      const cW = eW / gridCols;
      const cH = eH / gridRows;

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5 / ds;
      ctx.beginPath();
      for (let c = 1; c < gridCols; c++) {
        if (c % 5 !== 0) { ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH); }
      }
      for (let r = 1; r < gridRows; r++) {
        if (r % 5 !== 0) { ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH); }
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,50,50,0.8)';
      ctx.lineWidth = 1 / ds;
      ctx.beginPath();
      for (let c = 0; c <= gridCols; c += 5) {
        ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH);
      }
      for (let r = 0; r <= gridRows; r += 5) {
        ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH);
      }
      ctx.stroke();
    }

    // 黄色虚线框选
    const r = rect !== undefined ? rect : selRect;
    if (r && (r.w !== 0 || r.h !== 0)) {
      const rx = r.w >= 0 ? r.x : r.x + r.w;
      const ry = r.h >= 0 ? r.y : r.y + r.h;
      const rw = Math.abs(r.w);
      const rh = Math.abs(r.h);
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2 / ds;
      ctx.setLineDash([6 / ds, 3 / ds]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();

      const hs = 7 / ds;
      ctx.fillStyle = '#FFD700';
      [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginTop, marginRight, marginBottom, marginLeft, gridCols, gridRows, selRect]);

  // ── 把 canvas 坐标转为原图 margin ────────────────────────────────────────────
  const applySelRect = useCallback((r: SelectRect) => {
    const img = imgRef.current;
    if (!img) return;
    const ds = drawScaleRef.current;
    const cw = canvas_w();
    const ch = canvas_h();

    const x1 = Math.max(0, Math.min(r.w >= 0 ? r.x : r.x + r.w, cw));
    const y1 = Math.max(0, Math.min(r.h >= 0 ? r.y : r.y + r.h, ch));
    const x2 = Math.max(0, Math.min(r.w >= 0 ? r.x + r.w : r.x, cw));
    const y2 = Math.max(0, Math.min(r.h >= 0 ? r.y + r.h : r.y, ch));

    setMarginLeft(Math.round(x1 / ds));
    setMarginTop(Math.round(y1 / ds));
    setMarginRight(Math.round((cw - x2) / ds));
    setMarginBottom(Math.round((ch - y2) / ds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canvas_w = () => canvasRef.current?.width ?? 0;
  const canvas_h = () => canvasRef.current?.height ?? 0;

  // ── 获取鼠标在 canvas 上的坐标（考虑 zoom/pan）─────────────────────────────
  // canvasWrapper 内 canvas 用 CSS transform 做了缩放，
  // 所以鼠标坐标需要先减去 pan，再除以 zoom，再映射到 canvas 分辨率
  const getCanvasPos = useCallback((e: React.MouseEvent) => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return { x: 0, y: 0 };

    const wRect = wrapper.getBoundingClientRect();
    // 鼠标在 wrapper 内的坐标
    const wx = e.clientX - wRect.left;
    const wy = e.clientY - wRect.top;

    // canvas 左上角在 wrapper 内的 CSS 像素位置
    // canvas 被 transform: translate(panX, panY) scale(zoom) 作用
    // transformOrigin 是 '0 0'，所以 canvas 左上角在 wrapper 内 = (pan.x, pan.y)
    const canvasLeft = pan.x;
    const canvasTop = pan.y;

    // canvas 的 CSS 显示尺寸
    const cssW = canvas.width * zoom;
    const cssH = canvas.height * zoom;

    // 鼠标在 canvas CSS 区域内的坐标
    const cx = wx - canvasLeft;
    const cy = wy - canvasTop;

    // 转换到 canvas 像素坐标
    return {
      x: (cx / cssW) * canvas.width,
      y: (cy / cssH) * canvas.height,
    };
  }, [zoom, pan]);

  // ── 鼠标事件：框选 or 平移 ───────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isSpaceDown.current || e.button === 1) {
      // 空格 or 中键：平移模式
      isPanning.current = true;
      panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    } else if (e.button === 0) {
      // 左键：框选
      const pos = getCanvasPos(e);
      dragStart.current = pos;
      isDragging.current = true;
      setSelRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    }
  }, [pan, getCanvasPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({
        x: panStart.current.px + e.clientX - panStart.current.mx,
        y: panStart.current.py + e.clientY - panStart.current.my,
      });
      return;
    }
    if (!isDragging.current || !dragStart.current) return;
    const pos = getCanvasPos(e);
    const nr: SelectRect = {
      x: dragStart.current.x,
      y: dragStart.current.y,
      w: pos.x - dragStart.current.x,
      h: pos.y - dragStart.current.y,
    };
    setSelRect(nr);
    drawPreview(nr);
  }, [getCanvasPos, drawPreview]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }
    if (!isDragging.current || !dragStart.current) return;
    isDragging.current = false;
    const pos = getCanvasPos(e);
    const finalRect: SelectRect = {
      x: dragStart.current.x,
      y: dragStart.current.y,
      w: pos.x - dragStart.current.x,
      h: pos.y - dragStart.current.y,
    };
    dragStart.current = null;
    if (Math.abs(finalRect.w) < 3 || Math.abs(finalRect.h) < 3) {
      setSelRect(null);
      return;
    }
    setSelRect(finalRect);
    applySelRect(finalRect);
  }, [getCanvasPos, applySelRect]);

  // ── 滚轮缩放（以鼠标为中心）────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(prev => {
      const next = Math.max(0.2, Math.min(10, prev * factor));

      // 以鼠标位置为缩放中心
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

  // ── 键盘空格：平移模式切换 ──────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && step === 'config') { e.preventDefault(); isSpaceDown.current = true; }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') isSpaceDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [step]);

  // ── 适应屏幕 ─────────────────────────────────────────────────────────────────
  const fitToScreen = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ── 自动检测 ─────────────────────────────────────────────────────────────────
  const runDetect = async (dataUrl: string) => {
    setDetecting(true);
    setDetectInfo(null);
    try {
      const result = await detectGrid(dataUrl);
      setGridCols(result.cols);
      setGridRows(result.rows);
      setMarginTop(result.margin.top);
      setMarginRight(result.margin.right);
      setMarginBottom(result.margin.bottom);
      setMarginLeft(result.margin.left);
      // 同步更新选框
      const img = imgRef.current;
      if (img) {
        const ds = drawScaleRef.current;
        const cw = img.naturalWidth * ds;
        const ch = img.naturalHeight * ds;
        setSelRect({
          x: result.margin.left * ds,
          y: result.margin.top * ds,
          w: cw - (result.margin.left + result.margin.right) * ds,
          h: ch - (result.margin.top + result.margin.bottom) * ds,
        });
      }
      setDetectInfo(`自动识别：${result.cols}×${result.rows} 格，单格约 ${result.cellW}×${result.cellH}px`);
    } catch {
      setDetectInfo('自动识别失败，请手动框选有效区域');
    } finally {
      setDetecting(false);
    }
  };

  // ── 图片加载 ─────────────────────────────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setError(null);
    setSelRect(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
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

  // ── margin / grid 变化重绘 ────────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gridCols, gridRows, marginTop, marginRight, marginBottom, marginLeft]);

  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRect]);

  // ── 解析 ─────────────────────────────────────────────────────────────────────
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

  // ── 动态 cursor ──────────────────────────────────────────────────────────────
  const getCursor = () => {
    if (isPanning.current) return 'grabbing';
    if (isSpaceDown.current) return 'grab';
    return 'crosshair';
  };

  // ── Render: 上传步骤 ──────────────────────────────────────────────────────────
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

  // ── Render: 配置步骤 ──────────────────────────────────────────────────────────
  return (
    <div className={styles.configPanel}>

      {/* 左：预览区（缩放 + 框选） */}
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

        {/* canvas 容器（overflow hidden，内部用 transform） */}
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
          <strong>拖拽框选</strong>有效区域 &nbsp;|&nbsp; 蓝框 = 当前选区 &nbsp;|&nbsp; 红线 = 5×5 分块
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
          <p className={styles.sectionHint}>在左侧图片上拖拽框选有效区域，也可直接输入像素值</p>
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
