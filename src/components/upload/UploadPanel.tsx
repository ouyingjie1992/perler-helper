import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePerlerImage } from '../../utils/boardParser';
import { useBoardStore } from '../../store/boardStore';
import type { PerlerBoard } from '../../types';
import styles from './UploadPanel.module.css';

type Step = 'upload' | 'config';

export const UploadPanel: React.FC = () => {
  const setBoard = useBoardStore((s) => s.setBoard);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('upload');

  // 图纸规格
  const [gridCols, setGridCols] = useState(48);
  const [gridRows, setGridRows] = useState(48);
  const [marginTop, setMarginTop] = useState(14);
  const [marginRight, setMarginRight] = useState(14);
  const [marginBottom, setMarginBottom] = useState(14);
  const [marginLeft, setMarginLeft] = useState(14);

  const configCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // ── 图片加载 ──────────────────────────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPreviewUrl(dataUrl);
      imgRef.current = null;
      setStep('config');
    };
    reader.readAsDataURL(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.bmp', '.webp'] },
    maxFiles: 1,
  });

  useEffect(() => {
    if (!previewUrl) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; drawConfigPreview(); };
    img.src = previewUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  // ── 配置预览 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'config') requestAnimationFrame(() => drawConfigPreview());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gridCols, gridRows, marginTop, marginRight, marginBottom, marginLeft]);

  const drawConfigPreview = () => {
    const img = imgRef.current;
    const canvas = configCanvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d')!;

    const maxW = 540, maxH = 500;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const ml = marginLeft * scale, mt = marginTop * scale;
    const mr = marginRight * scale, mb = marginBottom * scale;
    const eW = canvas.width - ml - mr;
    const eH = canvas.height - mt - mb;
    const cW = eW / gridCols, cH = eH / gridRows;

    ctx.strokeStyle = 'rgba(30,144,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ml, mt, eW, eH);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.5;
    for (let c = 1; c < gridCols; c++) {
      if (c % 5 !== 0) {
        ctx.beginPath(); ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH); ctx.stroke();
      }
    }
    for (let r = 1; r < gridRows; r++) {
      if (r % 5 !== 0) {
        ctx.beginPath(); ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH); ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(255,50,50,0.85)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= gridCols; c += 5) {
      ctx.beginPath(); ctx.moveTo(ml + c * cW, mt); ctx.lineTo(ml + c * cW, mt + eH); ctx.stroke();
    }
    for (let r = 0; r <= gridRows; r += 5) {
      ctx.beginPath(); ctx.moveTo(ml, mt + r * cH); ctx.lineTo(ml + eW, mt + r * cH); ctx.stroke();
    }
  };

  // ── 解析 ──────────────────────────────────────────────────────────────────
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
    imgRef.current = null;
  };

  // ── Render ────────────────────────────────────────────────────────────────
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

  // step === 'config'
  return (
    <div className={styles.configPanel}>
      <div className={styles.previewArea}>
        <div className={styles.canvasWrapper}>
          <canvas ref={configCanvasRef} className={styles.previewCanvas} />
        </div>
        <p className={styles.previewHint}>
          蓝框 = 有效图纸区域 &nbsp;|&nbsp; 红线 = 5×5 分块线 &nbsp;|&nbsp; 调整参数使网格与格子对齐
        </p>
      </div>
      <div className={styles.configForm}>
        <h3 className={styles.configTitle}>图纸规格</h3>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>格子数量</h4>
          <div className={styles.inputRow}>
            <label className={styles.inputGroup}>
              <span>列（宽）</span>
              <input type="number" min={1} max={500} value={gridCols}
                onChange={(e) => setGridCols(Number(e.target.value))} className={styles.numInput} />
            </label>
            <span className={styles.times}>×</span>
            <label className={styles.inputGroup}>
              <span>行（高）</span>
              <input type="number" min={1} max={500} value={gridRows}
                onChange={(e) => setGridRows(Number(e.target.value))} className={styles.numInput} />
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>边距裁剪（像素）</h4>
          <p className={styles.sectionHint}>去除图纸四周的坐标轴标注区域</p>
          <div className={styles.marginGrid}>
            <div />
            <label className={styles.marginInput}><span>上</span>
              <input type="number" min={0} max={500} value={marginTop}
                onChange={(e) => setMarginTop(Number(e.target.value))} className={styles.smallInput} /></label>
            <div />
            <label className={styles.marginInput}><span>左</span>
              <input type="number" min={0} max={500} value={marginLeft}
                onChange={(e) => setMarginLeft(Number(e.target.value))} className={styles.smallInput} /></label>
            <div className={styles.marginCenter}>图纸</div>
            <label className={styles.marginInput}><span>右</span>
              <input type="number" min={0} max={500} value={marginRight}
                onChange={(e) => setMarginRight(Number(e.target.value))} className={styles.smallInput} /></label>
            <div />
            <label className={styles.marginInput}><span>下</span>
              <input type="number" min={0} max={500} value={marginBottom}
                onChange={(e) => setMarginBottom(Number(e.target.value))} className={styles.smallInput} /></label>
            <div />
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={handleReset}>重新上传</button>
          <button className={styles.btnPrimary} onClick={handleConfirm} disabled={loading}>
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>
      </div>
    </div>
  );
};
