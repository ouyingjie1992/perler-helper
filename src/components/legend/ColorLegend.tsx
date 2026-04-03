import React, { useState, useRef, useEffect } from 'react';
import { useBoardStore } from '../../store/boardStore';
import { getContrastColor } from '../../utils/boardParser';
import { MARK_COLOR_PALETTE } from '../../utils/markPalette';
import type { ColorStat } from '../../types';
import styles from './ColorLegend.module.css';

interface ColorLegendProps {
  colorStats: ColorStat[];
}

interface EditingState {
  oldCode: string;
  anchorTop: number;   // 弹窗定位用
}

export const ColorLegend: React.FC<ColorLegendProps> = ({ colorStats }) => {
  const { selectedColorCode, toggleSelectedColor, cellSize, setCellSize, showGrid, toggleGrid, setBoard, replaceColor } =
    useBoardStore();

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [search, setSearch] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const totalCells = colorStats.reduce((sum, s) => sum + s.count, 0);

  // 点击外部关闭弹窗
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setEditing(null);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const openEditor = (e: React.MouseEvent, code: string) => {
    e.stopPropagation();   // 不触发行的 toggle
    const btn = e.currentTarget as HTMLElement;
    const listRect = listRef.current?.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const top = btnRect.top - (listRect?.top ?? 0) + listRef.current!.scrollTop;
    setSearch('');
    setEditing({ oldCode: code, anchorTop: top });
  };

  const handleSelect = (newCode: string, newHex: string) => {
    if (!editing) return;
    replaceColor(editing.oldCode, newCode, newHex);
    setEditing(null);
    setSearch('');
  };

  // 过滤色卡（按码或名称搜索）
  const filtered = MARK_COLOR_PALETTE.filter((c) => {
    if (!search) return true;
    const q = search.toUpperCase();
    return c.code.toUpperCase().includes(q) || c.name.includes(search);
  });

  return (
    <aside className={styles.sidebar}>
      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <span className={styles.toolLabel}>格子大小</span>
          <div className={styles.sliderRow}>
            <input
              type="range" min={8} max={60} value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className={styles.slider}
            />
            <span className={styles.sliderVal}>{cellSize}px</span>
          </div>
        </div>
        <div className={styles.toolGroup}>
          <label className={styles.checkLabel}>
            <input type="checkbox" checked={showGrid} onChange={toggleGrid} className={styles.checkbox} />
            显示网格线
          </label>
        </div>
        <button className={styles.resetBtn} onClick={() => setBoard(null)}>
          重新上传
        </button>
      </div>

      <div className={styles.divider} />

      {/* 汇总 */}
      <div className={styles.summary}>
        <span className={styles.summaryItem}>共 <strong>{colorStats.length}</strong> 种颜色</span>
        <span className={styles.summaryItem}>共 <strong>{totalCells}</strong> 颗</span>
      </div>

      {selectedColorCode && (
        <div className={styles.highlightTip}>
          已选中 <code>{selectedColorCode}</code>，点击取消高亮
        </div>
      )}

      {/* 图例列表 */}
      <div className={styles.legendList} ref={listRef}>
        {colorStats.map((stat) => {
          const isSelected = selectedColorCode === stat.colorCode;
          const isOther = selectedColorCode !== null && !isSelected;
          const textColor = getContrastColor(stat.colorHex);
          const maxCount = Math.max(...colorStats.map((s) => s.count));

          return (
            <div
              key={stat.colorCode}
              className={`${styles.legendItem} ${isSelected ? styles.selected : ''} ${isOther ? styles.dimmed : ''}`}
            >
              {/* 点击色块行 → 高亮 */}
              <button
                className={styles.legendRow}
                onClick={() => toggleSelectedColor(stat.colorCode)}
                title={`颜色 ${stat.colorCode}：共 ${stat.count} 颗，点击高亮`}
              >
                <span className={styles.colorSwatch} style={{ background: stat.colorHex }}>
                  <span className={styles.swatchCode} style={{ color: textColor }}>
                    {stat.colorCode}
                  </span>
                </span>
                <span className={styles.colorInfo}>
                  <span className={styles.colorCode}>{stat.colorCode}</span>
                  <span className={styles.colorHex}>{stat.colorHex}</span>
                </span>
                <span className={styles.colorCount}>
                  <span className={styles.countNum}>{stat.count}</span>
                  <span className={styles.countLabel}>颗</span>
                </span>
              </button>

              {/* 修正按钮 */}
              <button
                className={styles.editBtn}
                onClick={(e) => openEditor(e, stat.colorCode)}
                title={`修正 ${stat.colorCode} 的色码`}
              >
                ✎
              </button>

              {/* 底部数量条 */}
              <span
                className={styles.countBar}
                style={{ width: `${(stat.count / maxCount) * 100}%`, background: stat.colorHex }}
              />
            </div>
          );
        })}

        {/* 色卡选择弹窗（定位在列表内） */}
        {editing && (
          <div
            ref={popupRef}
            className={styles.colorPickerPopup}
            style={{ top: editing.anchorTop }}
          >
            <div className={styles.popupHeader}>
              <span className={styles.popupTitle}>修正 <code>{editing.oldCode}</code> → 选择新色码</span>
              <button className={styles.popupClose} onClick={() => { setEditing(null); setSearch(''); }}>✕</button>
            </div>
            <input
              className={styles.popupSearch}
              placeholder="搜索色码或名称…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className={styles.paletteGrid}>
              {filtered.map((c) => (
                <button
                  key={c.code}
                  className={styles.paletteItem}
                  style={{ background: c.hex }}
                  title={`${c.code} ${c.name}`}
                  onClick={() => handleSelect(c.code, c.hex)}
                >
                  <span
                    className={styles.paletteCode}
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
        )}
      </div>
    </aside>
  );
};
