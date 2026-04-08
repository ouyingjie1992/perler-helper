/**
 * PaletteSelector.tsx
 *
 * 分两个区域：
 *   1. 「已选颜色」列表 —— 显示已选色码 + 数量输入框 + 删除按钮
 *   2. 「全量色板」 —— 按系列分组，点击切换选中；已选色块高亮
 *
 * 交互逻辑：
 *   - 点色板色块 → 加入/移除已选
 *   - 在已选列表输入数量 → 记录到 HintItem.count
 *   - 点已选列表删除 → 移出已选
 */

import React, { useMemo, useState } from 'react';
import { MARK_COLOR_PALETTE } from '../../utils/markPalette';
import type { HintItem } from '../../store/boardStore';
import styles from './PaletteSelector.module.css';

interface PaletteSelectorProps {
  items: HintItem[];
  onChange: (items: HintItem[]) => void;
}

/** 根据背景 hex 决定文字用黑还是白 */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#000' : '#fff';
}

// 按首字母（去数字）分组
function buildGroups() {
  const map = new Map<string, typeof MARK_COLOR_PALETTE>();
  for (const color of MARK_COLOR_PALETTE) {
    const prefix = color.code.replace(/[0-9]/g, '');
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix)!.push(color);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

const ALL_GROUPS = buildGroups();

export const PaletteSelector: React.FC<PaletteSelectorProps> = ({ items, onChange }) => {
  const [query, setQuery] = useState('');

  // 快速查询 code → item
  const itemMap = useMemo(
    () => new Map(items.map((h) => [h.code, h])),
    [items],
  );

  // ── 切换选中 ───────────────────────────────────────────────────────────────
  const toggle = (code: string) => {
    if (itemMap.has(code)) {
      onChange(items.filter((h) => h.code !== code));
    } else {
      onChange([...items, { code }]);
    }
  };

  // ── 更新数量 ───────────────────────────────────────────────────────────────
  const setCount = (code: string, raw: string) => {
    const n = parseInt(raw, 10);
    const count = isNaN(n) || n <= 0 ? undefined : n;
    onChange(items.map((h) => (h.code === code ? { ...h, count } : h)));
  };

  // ── 删除已选 ───────────────────────────────────────────────────────────────
  const remove = (code: string) => onChange(items.filter((h) => h.code !== code));

  // ── 组全选/取消 ────────────────────────────────────────────────────────────
  const toggleGroup = (colors: typeof MARK_COLOR_PALETTE) => {
    const codes = colors.map((c) => c.code);
    const allSel = codes.every((c) => itemMap.has(c));
    if (allSel) {
      onChange(items.filter((h) => !codes.includes(h.code)));
    } else {
      const existing = new Set(items.map((h) => h.code));
      const toAdd = codes.filter((c) => !existing.has(c)).map((code) => ({ code }));
      onChange([...items, ...toAdd]);
    }
  };

  // ── 搜索过滤 ───────────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return ALL_GROUPS;
    return ALL_GROUPS
      .map(([prefix, colors]) => [
        prefix,
        colors.filter((c) => c.code.toUpperCase().includes(q)),
      ] as [string, typeof MARK_COLOR_PALETTE])
      .filter(([, colors]) => colors.length > 0);
  }, [query]);

  // 已选色码的完整颜色信息（用于已选列表渲染）
  const colorMap = useMemo(
    () => new Map(MARK_COLOR_PALETTE.map((c) => [c.code, c])),
    [],
  );

  return (
    <div className={styles.root}>

      {/* ── 已选颜色列表 ───────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className={styles.selectedSection}>
          <div className={styles.selectedHeader}>
            <span className={styles.selectedTitle}>已选 {items.length} 种颜色</span>
            <button className={styles.clearAll} onClick={() => onChange([])}>全部清除</button>
          </div>
          <div className={styles.selectedList}>
            {items.map((item) => {
              const colorInfo = colorMap.get(item.code);
              const hex = colorInfo?.hex ?? '#888';
              return (
                <div key={item.code} className={styles.selectedItem}>
                  {/* 色块 */}
                  <span
                    className={styles.selectedSwatch}
                    style={{ background: hex }}
                    title={item.code}
                  />
                  {/* 色码 */}
                  <span className={styles.selectedCode}>{item.code}</span>
                  {/* 数量输入 */}
                  <input
                    className={styles.countInput}
                    type="number"
                    min={1}
                    placeholder="数量"
                    value={item.count ?? ''}
                    onChange={(e) => setCount(item.code, e.target.value)}
                    title={`${item.code} 的格子数量（可选）`}
                  />
                  <span className={styles.countUnit}>格</span>
                  {/* 删除 */}
                  <button
                    className={styles.removeBtn}
                    onClick={() => remove(item.code)}
                    title="移除"
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 色板选择区 ─────────────────────────────────────────────────────── */}
      <div className={styles.paletteSection}>
        <div className={styles.paletteHeader}>
          <span className={styles.paletteTitle}>Mark 色板</span>
          <input
            className={styles.search}
            type="text"
            placeholder="搜索色码…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className={styles.groups}>
          {filteredGroups.map(([prefix, colors]) => {
            const codes = colors.map((c) => c.code);
            const allSel = codes.every((c) => itemMap.has(c));
            const someSel = !allSel && codes.some((c) => itemMap.has(c));
            return (
              <div key={prefix} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupLabel}>{prefix}</span>
                  <button
                    className={`${styles.groupToggle} ${allSel ? styles.groupToggleActive : someSel ? styles.groupTogglePartial : ''}`}
                    onClick={() => toggleGroup(colors)}
                  >
                    {allSel ? '取消' : '全选'}
                  </button>
                </div>
                <div className={styles.swatches}>
                  {colors.map((color) => {
                    const isSel = itemMap.has(color.code);
                    return (
                      <button
                        key={color.code}
                        className={`${styles.swatch} ${isSel ? styles.swatchSelected : ''}`}
                        style={{
                          background: color.hex,
                          color: contrastColor(color.hex),
                        }}
                        onClick={() => toggle(color.code)}
                        title={color.code}
                      >
                        {color.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
