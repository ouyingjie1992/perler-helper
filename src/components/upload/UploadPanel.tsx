import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePerlerImage } from '../../utils/boardParser';
import { detectGrid } from '../../utils/gridDetector';
import { useBoardStore } from '../../store/boardStore';
import type { PerlerBoard } from '../../types';
import styles from './UploadPanel.module.css';

type Step = 'upload' | 'config';

// 预览 canvas 最大显示尺寸
const MAX_PREVIEW_W = 600;
const MAX_PREVIEW_H = 560;

// 框选状态
interface SelectRect {
  x: number; y: number; w: number; h: number; // canvas 坐标
}

export const UploadPanel: React.FC = () => {
  const setBoard = useBoardStore((s) => s.setBoard);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectInfo, setDetectInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('upload');

  // 图纸规格
  const [gridCols, setGridCols] = useState(48);
  const [gridRows, setGridRows] = useState(48);
  // margin 用原始图片像素表示
  const [marginTop, setMarginTop] = useState(0);
  const [marginRight, setMarginRight] = useState(0);
  const [marginBottom, setMarginBottom] = useState(0);
  const [marginLeft, setMarginLeft] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // 当前 canvas 的缩放比（canvas px / 原图 px）
  const scaleRef = useRef(1);

  // 框选拖拽状态（canvas 坐标）
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<SelectRect | null>(null);
  const isDragging = useRef(false);

  // ── 计算预览缩放比 ──────────────────────────────────────────────────────────
  const getScale = (img: HTMLImageElement) =>
    Math.min(MAX_PREVIEW_W / img.naturalWidth, MAX_PREVIEW_H / img.naturalHeight, 1);

  // ── 绘制预览 canvas ─────────────────────────────────────────────────────────
  const drawPreview = useCallback((rect?: SelectRect | null) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d')!;

    const scale = getScale(img);
    scaleRef.current = scale;
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;

    // 底图
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 当前有效区域（由 margin 换算到 canvas 坐标）
    const ml = marginLeft * scale;
    const mt = marginTop * scale;
    const mr = marginRight * scale;
    const mb = marginBottom * scale;
    const eW = canvas.width - ml - mr;
    const eH = canvas.height - mt - mb;

    // 四周暗遮罩（选区外变暗）
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    // top
    ctx.fillRect(0, 0, canvas.width, mt);
    // bottom
    ctx.fillRect(0, mt + eH, canvas.width, canvas.height - mt - eH);
    // left
    ctx.fillRect(0, mt, ml, eH);
    // right
    ctx.fillRect(ml + eW, mt, canvas.width - ml - eW, eH);

    // 有效区域蓝框
    ctx.strokeStyle = 'rgba(30,144,255,1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ml, mt, eW, eH);

    // 网格线
    if (eW > 0 && eH > 0 && gridCols > 0 && gridRows > 0) {
      const cW = eW / gridCols;
      const cH = eH / gridRows;

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let c = 1; c < gridCols; c++) {
        if (c % 5 !== 0) {
          ctx.moveTo(ml + c * cW, mt);
          ctx.lineTo(ml + c * cW, mt + eH);
        }
      }
      for (let r = 1; r < gridRows; r++) {
        if (r % 5 !== 0) {
          ctx.moveTo(ml, mt + r * cH);
          ctx.lineTo(ml + eW, mt + r * cH);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,50,50,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= gridCols; c += 5) {
        ctx.moveTo(ml + c * cW, mt);
        ctx.lineTo(ml + c * cW, mt + eH);
      }
      for (let r = 0; r <= gridRows; r += 5) {
        ctx.moveTo(ml, mt + r * cH);
        ctx.lineTo(ml + eW, mt + r * cH);
      }
      ctx.stroke();
    }

    // 正在拖拽的选框（黄色虚线）
    const r = rect !== undefined ? rect : selRect;
    if (r && r.w !== 0 && r.h !== 0) {
      const rx = r.w > 0 ? r.x : r.x + r.w;
      const ry = r.h > 0 ? r.y : r.y + r.h;
      const rw = Math.abs(r.w);
      const rh = Math.abs(r.h);
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();

      // 四个角的小方块手柄
      const hs = 7;
      ctx.fillStyle = '#FFD700';
      [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginTop, marginRight, marginBottom, marginLeft, gridCols, gridRows, selRect]);

  // ── 框选结束：把 canvas 坐标转换成原图 margin ──────────────────────────────
  const applySelRect = useCallback((r: SelectRect) => {
    const img = imgRef.current;
    if (!img) return;
    const scale = scaleRef.current;
    const cw = img.naturalWidth * scale;
    const ch = img.naturalHeight * scale;

    // 规范化（允许反向拖拽）
    const x1 = Math.max(0, Math.min(r.w > 0 ? r.x : r.x + r.w, cw));
    const y1 = Math.max(0, Math.min(r.h > 0 ? r.y : r.y + r.h, ch));
    const x2 = Math.max(0, Math.min(r.w > 0 ? r.x + r.w : r.x, cw));
    const y2 = Math.max(0, Math.min(r.h > 0 ? r.y + r.h : r.y, ch));

    // canvas 坐标 → 原图像素 margin
    const ml = Math.round(x1 / scale);
    const mt = Math.round(y1 / scale);
    const mr = Math.round((cw - x2) / scale);
    const mb = Math.round((ch - y2) / scale);

    setMarginLeft(ml);
    setMarginTop(mt);
    setMarginRight(mr);
    setMarginBottom(mb);
  }, []);

  // ── 鼠标事件 ───────────────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    // getBoundingClientRect 给的是 CSS 尺寸，canvas 可能有 CSS 缩放
    const canvas = canvasRef.current!;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    dragStart.current = pos;
    isDragging.current = true;
    setSelRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    // 如果框选太小，忽略
    if (Math.abs(finalRect.w) < 5 || Math.abs(finalRect.h) < 5) {
      setSelRect(null);
      return;
    }
    setSelRect(finalRect);
    applySelRect(finalRect);
  };

  // ── 自动检测 ───────────────────────────────────────────────────────────────
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
      // 同步更新选框显示
      const img = imgRef.current;
      if (img) {
        const scale = getScale(img);
        const cw = img.naturalWidth * scale;
        const ch = img.naturalHeight * scale;
        setSelRect({
          x: result.margin.left * scale,
          y: result.margin.top * scale,
          w: cw - (result.margin.left + result.margin.right) * scale,
          h: ch - (result.margin.top + result.margin.bottom) * scale,
        });
      }
      setDetectInfo(
        `自动识别：${result.cols}×${result.rows} 格，单格约 ${result.cellW}×${result.cellH}px`
      );
    } catch {
      setDetectInfo('自动识别失败，请手动框选有效区域');
    } finally {
      setDetecting(false);
    }
  };

  // ── 图片加载 ───────────────────────────────────────────────────────────────
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
      // 图片加载后再检测
      const img = new Image();
      img.onload = async () => {
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

  // ── margin / gridCols / gridRows 变化时重绘 ─────────────────────────────────
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gridCols, gridRows, marginTop, marginRight, marginBottom, marginLeft]);

  // selRect 变化时（由检测填充）也重绘
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRect]);

  // ── 解析 ───────────────────────────────────────────────────────────────────
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
  };

  // ── Render: 上传步骤 ───────────────────────────────────────────────────────
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

  // ── Render: 配置步骤 ───────────────────────────────────────────────────────
  return (
    <div className={styles.configPanel}>

      {/* 左：预览 canvas（可框选） */}
      <div className={styles.previewArea}>
        <div className={styles.canvasWrapper}>
          <canvas
            ref={canvasRef}
            className={styles.previewCanvas}
            style={{ cursor: 'crosshair' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={(e) => { if (isDragging.current) handleMouseUp(e); }}
          />
        </div>
        <p className={styles.previewHint}>
          <strong>拖拽框选</strong>有效图纸区域（排除边框/图例）&nbsp;|&nbsp;
          蓝框 = 当前选区 &nbsp;|&nbsp; 红线 = 5×5 分块
        </p>
      </div>

      {/* 右：配置表单 */}
      <div className={styles.configForm}>

        {/* 标题行 */}
        <div className={styles.configTitleRow}>
          <h3 className={styles.configTitle}>图纸规格</h3>
          <button
            className={styles.btnRedetect}
            disabled={detecting || !previewUrl}
            onClick={() => previewUrl && runDetect(previewUrl)}
            title="重新自动识别网格"
          >
            {detecting ? '识别中…' : '自动识别'}
          </button>
        </div>

        {/* 检测结果提示 */}
        {detectInfo && <p className={styles.detectInfo}>{detectInfo}</p>}

        {/* 格子数量 */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>格子数量（手动填写）</h4>
          <div className={styles.inputRow}>
            <label className={styles.inputGroup}>
              <span>列（宽）</span>
              <input
                type="number" min={1} max={500} value={gridCols}
                onChange={(e) => setGridCols(Math.max(1, Number(e.target.value)))}
                className={styles.numInput}
              />
            </label>
            <span className={styles.times}>×</span>
            <label className={styles.inputGroup}>
              <span>行（高）</span>
              <input
                type="number" min={1} max={500} value={gridRows}
                onChange={(e) => setGridRows(Math.max(1, Number(e.target.value)))}
                className={styles.numInput}
              />
            </label>
          </div>
        </section>

        {/* 当前 margin 只读展示 */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>边距（自动/框选填充）</h4>
          <p className={styles.sectionHint}>
            在左侧图片上拖拽框选有效区域，也可直接输入像素值
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
          <button
            className={styles.btnPrimary}
            onClick={handleConfirm}
            disabled={loading || detecting}
          >
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>

      </div>
    </div>
  );
};
