import React, { useState, useRef, useCallback } from 'react';
import { useBoardStore } from '../../store/boardStore';
import { getContrastColor } from '../../utils/boardParser';
import { MARK_COLOR_PALETTE } from '../../utils/markPalette';
import type { ColorStat } from '../../types';
import styles from './ColorLegend.module.css';

const ExitFocusIconSmall: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 01-2 2H3" />
    <path d="M21 8h-3a2 2 0 01-2-2V3" />
    <path d="M3 16h3a2 2 0 012 2v3" />
    <path d="M16 21v-3a2 2 0 012-2h3" />
  </svg>
);

/** 计算偏差标签 */
function buildDiffLabel(
  actual: number,
  expected: number,
): { text: string; level: 'ok' | 'warn' | 'error' } | null {
  if (!expected) return null;
  const diff = actual - expected;
  const ratio = Math.abs(diff) / expected;
  const sign = diff > 0 ? '+' : '';
  const text = `期望 ${expected}，实际 ${actual}（${sign}${diff}）`;
  if (ratio <= 0.05) return { text, level: 'ok' };
  if (ratio <= 0.30) return { text, level: 'warn' };
  return { text, level: 'error' };
}

interface ColorLegendProps {
  colorStats: ColorStat[];
}

export const ColorLegend: React.FC<ColorLegendProps> = ({ colorStats }) => {
  const {
    selectedColorCode,
    toggleSelectedColor,
    cellSize,
    setCellSize,
    showGrid,
    toggleGrid,
    setBoard,
    replaceColor,
    hintItems,
    board,
    editingColorCode,
    setEditingColorCode,
    focusMode,
    toggleFocusMode,
  } = useBoardStore();

  // 专注模式时强制 strip，禁止手动展开
  const [drawerState, setDrawerState] = useState<'collapsed' | 'strip' | 'expanded'>('strip');
  const effectiveDrawerState = focusMode ? 'strip' : drawerState;
  // 本地搜索（编辑弹窗内）
  const [search, setSearch] = useState('');
  // 工具栏折叠
  const [toolsOpen, setToolsOpen] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartState = useRef<'collapsed' | 'strip' | 'expanded'>('strip');

  const totalCells = colorStats.reduce((sum, s) => sum + s.count, 0);
  const maxCount = colorStats.length > 0 ? Math.max(...colorStats.map((s) => s.count)) : 1;

  // ── 弹窗色板：若 board 有 hintCodes 则只显示这些色；否则全量 ──────────
  const hintCodes = board?.hintCodes;
  const paletteSource = (hintCodes && hintCodes.length > 0)
    ? MARK_COLOR_PALETTE.filter((c) => hintCodes.includes(c.code))
    : MARK_COLOR_PALETTE;

  // 搜索过滤
  const filtered = paletteSource.filter((c) => {
    if (!search) return true;
    const q = search.toUpperCase();
    return c.code.toUpperCase().includes(q) || c.name.includes(search);
  });

  // 关闭编辑弹窗（点击背景）
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setEditingColorCode(null);
      setSearch('');
    }
  };

  const handleSelect = (newCode: string, newHex: string) => {
    if (!editingColorCode) return;
    replaceColor(editingColorCode, newCode, newHex);
    setEditingColorCode(null);
    setSearch('');
  };

  // 拖动手柄 – 触摸 & 鼠标
  const onDragStart = useCallback((clientY: number) => {
    dragStartY.current = clientY;
    dragStartState.current = drawerState;
  }, [drawerState]);

  const onDragEnd = useCallback((clientY: number) => {
    if (dragStartY.current === null) return;
    const delta = dragStartY.current - clientY; // 向上为正
    if (delta > 40) {
      // 向上拖：升级状态
      setDrawerState((s) => s === 'collapsed' ? 'strip' : 'expanded');
    } else if (delta < -40) {
      // 向下拖：降级状态
      setDrawerState((s) => s === 'expanded' ? 'strip' : 'collapsed');
    }
    dragStartY.current = null;
  }, []);

  const handleHandleMouseDown = (e: React.MouseEvent) => {
    onDragStart(e.clientY);
    const onUp = (ev: MouseEvent) => {
      onDragEnd(ev.clientY);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
  };

  const handleHandleTouchStart = (e: React.TouchEvent) => {
    onDragStart(e.touches[0].clientY);
  };
  const handleHandleTouchEnd = (e: React.TouchEvent) => {
    onDragEnd(e.changedTouches[0].clientY);
  };

  return (
    <>
      {/* ── 底部抽屉 ────────────────────────────────────────────────── */}
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${styles[`drawer_${effectiveDrawerState}`]} ${focusMode ? styles.drawerFocus : ''}`}
      >
        {/* 拖动手柄 */}
        <div
          className={styles.handle}
          onMouseDown={focusMode ? undefined : handleHandleMouseDown}
          onTouchStart={focusMode ? undefined : handleHandleTouchStart}
          onTouchEnd={focusMode ? undefined : handleHandleTouchEnd}
          onClick={focusMode ? undefined : () =>
            setDrawerState((s) =>
              s === 'expanded' ? 'strip' : s === 'strip' ? 'expanded' : 'strip',
            )
          }
        >
          <span className={styles.handleBar} />
          <div className={styles.handleMeta}>
            <span className={styles.metaChip}>
              <strong>{colorStats.length}</strong> 色
            </span>
            <span className={styles.metaChip}>
              <strong>{totalCells}</strong> 颗
            </span>
            {selectedColorCode && (
              <span className={styles.metaChipActive}>
                已选 <code>{selectedColorCode}</code>
              </span>
            )}
          </div>
          {/* 工具按钮 */}
          <div className={styles.handleActions}>
            {focusMode ? (
              /* 专注模式：只显示退出按钮 */
              <button
                className={styles.focusExitBtnLegend}
                onClick={(e) => { e.stopPropagation(); toggleFocusMode(); }}
                title="退出专注模式"
              >
                <ExitFocusIconSmall /> 退出专注
              </button>
            ) : (
              <>
                <button
                  className={styles.toolToggleBtn}
                  onClick={(e) => { e.stopPropagation(); setToolsOpen((v) => !v); }}
                  title="显示工具栏"
                >
                  ⚙
                </button>
                <button
                  className={styles.chevronBtn}
                  tabIndex={-1}
                  aria-label={drawerState === 'expanded' ? '收起' : '展开'}
                >
                  {drawerState === 'expanded' ? '▾' : '▴'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 工具栏（专注模式下不渲染） */}
        {!focusMode && toolsOpen && (
          <div className={styles.toolbar}>
            <div className={styles.toolRow}>
              <span className={styles.toolLabel}>格子大小</span>
              <input
                type="range" min={8} max={60} value={cellSize}
                onChange={(e) => setCellSize(Number(e.target.value))}
                className={styles.slider}
              />
              <span className={styles.sliderVal}>{cellSize}px</span>
            </div>
            <div className={styles.toolRow}>
              <label className={styles.checkLabel}>
                <input type="checkbox" checked={showGrid} onChange={toggleGrid} className={styles.checkbox} />
                显示网格线
              </label>
              <button className={styles.resetBtn} onClick={() => setBoard(null)}>
                重新上传
              </button>
            </div>
          </div>
        )}

        {/* strip 模式：水平色块滚动条 */}
        {effectiveDrawerState !== 'collapsed' && (
          <div className={styles.strip}>
            {colorStats.map((stat) => {
              const isSelected = selectedColorCode === stat.colorCode;
              const isOther = selectedColorCode !== null && !isSelected;
              const textColor = getContrastColor(stat.colorHex);
              return (
                <button
                  key={stat.colorCode}
                  className={`${styles.stripItem} ${isSelected ? styles.stripSelected : ''} ${isOther ? styles.stripDimmed : ''}`}
                  style={{ background: stat.colorHex }}
                  onClick={() => toggleSelectedColor(stat.colorCode)}
                  title={`${stat.colorCode}：${stat.count} 颗`}
                >
                  <span className={styles.stripCode} style={{ color: textColor }}>
                    {stat.colorCode}
                  </span>
                  <span className={styles.stripCount} style={{ color: textColor }}>
                    {stat.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* expanded 模式：完整列表（专注模式下不渲染） */}
        {!focusMode && effectiveDrawerState === 'expanded' && (
          <div className={styles.expandedList}>
            {colorStats.map((stat) => {
              const isSelected = selectedColorCode === stat.colorCode;
              const isOther = selectedColorCode !== null && !isSelected;
              const textColor = getContrastColor(stat.colorHex);
              const hint = hintItems.find((h) => h.code === stat.colorCode);
              const diff = hint?.count ? buildDiffLabel(stat.count, hint.count) : null;

              return (
                <div
                  key={stat.colorCode}
                  className={`${styles.listItem} ${isSelected ? styles.listSelected : ''} ${isOther ? styles.listDimmed : ''}`}
                >
                  {/* 左侧色块 + 高亮按钮 */}
                  <button
                    className={styles.listSwatch}
                    style={{ background: stat.colorHex }}
                    onClick={() => toggleSelectedColor(stat.colorCode)}
                    title={`高亮 ${stat.colorCode}`}
                  >
                    <span className={styles.swatchCode} style={{ color: textColor }}>
                      {stat.colorCode}
                    </span>
                  </button>

                  {/* 中间信息 */}
                  <div className={styles.listInfo}>
                    <div className={styles.listTopRow}>
                      <span className={styles.listCode}>{stat.colorCode}</span>
                      <span className={styles.listHex}>{stat.colorHex}</span>
                      {diff && (
                        <span
                          className={`${styles.hintDiff} ${styles[`hintDiff_${diff.level}`]}`}
                          title={diff.text}
                        >
                          {diff.text}
                        </span>
                      )}
                    </div>
                    {/* 数量条 */}
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{ width: `${(stat.count / maxCount) * 100}%`, background: stat.colorHex }}
                      />
                    </div>
                  </div>

                  {/* 右侧颗数 + 编辑按钮 */}
                  <div className={styles.listRight}>
                    <span className={styles.listCount}>{stat.count}</span>
                    <span className={styles.listCountLabel}>颗</span>
                    <button
                      className={styles.editBtn}
                      onClick={() => { setEditingColorCode(stat.colorCode); setSearch(''); }}
                      title={`修正 ${stat.colorCode}`}
                    >
                      ✎
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 修正色码：全屏模态层 ───────────────────────────────────── */}
      {editingColorCode && (
        <div className={styles.modalBackdrop} onClick={handleBackdropClick}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>
                修正 <code className={styles.modalCode}>{editingColorCode}</code> → 选择新色码
                {hintCodes && hintCodes.length > 0 && (
                  <span className={styles.modalHint}>（仅显示图纸涉及的 {hintCodes.length} 种颜色）</span>
                )}
              </span>
              <button
                className={styles.modalClose}
                onClick={() => { setEditingColorCode(null); setSearch(''); }}
              >
                ✕
              </button>
            </div>
            <input
              className={styles.modalSearch}
              placeholder="搜索色码或名称…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className={styles.modalGrid}>
              {filtered.map((c) => (
                <button
                  key={c.code}
                  className={styles.modalSwatch}
                  style={{ background: c.hex }}
                  title={`${c.code} ${c.name}`}
                  onClick={() => handleSelect(c.code, c.hex)}
                >
                  <span
                    className={styles.modalSwatchCode}
                    style={{ color: getContrastColor(c.hex) }}
                  >
                    {c.code}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className={styles.noResult}>无匹配色码</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
